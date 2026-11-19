/**
 * The journal (architecture §2.4 step 3, D9, N-04): every change is written down *before* it is made — what was
 * there, what is set — and undone in reverse order. This is the pure model: a computer's lockable parts as plain
 * data, and each change kind with its undo. The Guard's executors (M4) do the same to real Windows.
 */
import { z } from 'zod';

const text = z.string().min(1);
const ports = z.array(z.int().min(1).max(65_535));

/** A registry value; null when it doesn't exist. */
const regValue = z.union([z.int(), z.string()]).nullable();
export const firewallRule = z.object({
  name: text, program: text.optional(), service: text.optional(), protocol: z.enum(['tcp', 'udp']),
  remoteAddress: text.optional(), localPorts: ports.optional(), remotePorts: ports.optional(),
});
const firewallProfile = z.enum(['domain', 'private', 'public']);
const outbound = z.enum(['allow', 'block']);
const shell = z.enum(['running', 'stopped']);
const onOff = z.enum(['on', 'off']);
const written = { id: z.int().positive(), at: z.int() };

/** `{ id, kind, target, before, after, at }` — one per change. A registry target is the key and the value's name. */
export const journalEntry = z.discriminatedUnion('kind', [
  z.object({ ...written, kind: z.literal('registry'), target: text, before: regValue, after: regValue }),
  z.object({ ...written, kind: z.literal('firewallRule'), target: text, before: firewallRule.nullable(), after: firewallRule.nullable() }),
  // the firewall itself, per profile: blocking outbound traffic does nothing where a school has switched it off
  z.object({ ...written, kind: z.literal('firewallState'), target: firewallProfile, before: onOff, after: onOff }),
  z.object({ ...written, kind: z.literal('firewallOutbound'), target: firewallProfile, before: outbound, after: outbound }),
  z.object({ ...written, kind: z.literal('explorer'), target: z.literal('shell'), before: shell, after: shell }),
]);
export type JournalEntry = z.infer<typeof journalEntry>;
export type FirewallRule = z.infer<typeof firewallRule>;
export type FirewallProfile = z.infer<typeof firewallProfile>;

/** A change the plan asks for: an entry without what the journal adds. */
export type Change = JournalEntry extends infer E ? (E extends JournalEntry ? Omit<E, 'id' | 'before' | 'at'> : never) : never;

/** A change as it is sent to the Guard: checked before anything is done with it. */
export const change = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('registry'), target: text, after: regValue }),
  z.object({ kind: z.literal('firewallRule'), target: text, after: firewallRule.nullable() }),
  z.object({ kind: z.literal('firewallState'), target: firewallProfile, after: onOff }),
  z.object({ kind: z.literal('firewallOutbound'), target: firewallProfile, after: outbound }),
  z.object({ kind: z.literal('explorer'), target: z.literal('shell'), after: shell }),
]);

/** The parts of a computer the lockdown changes. */
export interface SystemState {
  /** `HKLM\…\Name` or `HKU\<SID>\…\Name` → the value; a missing key means it doesn't exist */
  registry: Record<string, number | string>;
  firewall: { enabled: Record<FirewallProfile, 'on' | 'off'>; outbound: Record<FirewallProfile, 'allow' | 'block'>; rules: Record<string, FirewallRule> };
  explorer: 'running' | 'stopped';
}

function withEntry<T>(record: Record<string, T>, key: string, value: T | null): Record<string, T> {
  const rest = Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
  return value === null ? rest : { ...rest, [key]: value };
}

/** What a change's target is now. */
export function read(state: SystemState, change: Pick<Change, 'kind' | 'target'>): JournalEntry['before'] {
  switch (change.kind) {
    case 'registry': return state.registry[change.target] ?? null;
    case 'firewallRule': return state.firewall.rules[change.target] ?? null;
    case 'firewallState': return state.firewall.enabled[change.target as FirewallProfile];
    case 'firewallOutbound': return state.firewall.outbound[change.target as FirewallProfile];
    case 'explorer': return state.explorer;
  }
}

/** Make a change. Setting null deletes a registry value or a firewall rule. */
export function apply(state: SystemState, change: Change): SystemState {
  switch (change.kind) {
    case 'registry': return { ...state, registry: withEntry(state.registry, change.target, change.after) };
    case 'firewallRule': return { ...state, firewall: { ...state.firewall, rules: withEntry(state.firewall.rules, change.target, change.after) } };
    case 'firewallState': return { ...state, firewall: { ...state.firewall, enabled: { ...state.firewall.enabled, [change.target]: change.after } } };
    case 'firewallOutbound': return { ...state, firewall: { ...state.firewall, outbound: { ...state.firewall.outbound, [change.target]: change.after } } };
    case 'explorer': return { ...state, explorer: change.after };
  }
}

/** The journal entry for a change that is about to be made: what is there now goes in `before`. */
export function record(state: SystemState, change: Change, id: number, at: number): JournalEntry {
  return { ...change, id, before: read(state, change), at } as JournalEntry;
}

/** Undo one entry: put back what was there. Safe if the change was never made, or is undone twice. */
export function undo(state: SystemState, entry: JournalEntry): SystemState {
  return apply(state, { kind: entry.kind, target: entry.target, after: entry.before } as Change);
}

/** Lock: journal each change, then make it. */
export function lock(state: SystemState, plan: Change[], at: number): { state: SystemState; journal: JournalEntry[] } {
  const journal: JournalEntry[] = [];
  for (const change of plan) {
    journal.push(record(state, change, journal.length + 1, at));
    state = apply(state, change);
  }
  return { state, journal };
}

/** Unlock: undo every entry, the last first. */
export function unlock(state: SystemState, journal: JournalEntry[]): SystemState {
  return journal.reduceRight(undo, state);
}

/** One entry, one line: an entry cut short by a crash can then be told from a whole one. */
export const serialize = (entry: JournalEntry): string => `${JSON.stringify(entry)}\n`;

/** Read a journal back. A line that isn't a whole entry is left out — it was written before its change was made,
 *  so there is nothing of it to undo — and `damaged` says so. */
export function parseJournal(text: string): { entries: JournalEntry[]; damaged: boolean } {
  const entries: JournalEntry[] = [];
  let damaged = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const entry = journalEntry.safeParse(parseJson(line));
    if (entry.success) entries.push(entry.data);
    else damaged = true;
  }
  return { entries, damaged };
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
