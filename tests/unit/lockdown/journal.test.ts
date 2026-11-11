import { describe, expect, it } from 'vitest';
import { apply, lock, parseJournal, read, record, serialize, undo, unlock, type Change, type SystemState } from '@lib/lockdown/journal';
import { plan } from '@lib/lockdown/plan';
import { word } from '../../fixtures/profiles';

const SID = 'S-1-5-21-1004336348-1177238915-682003330-1001';
const POLICIES = `HKU\\${SID}\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies`;
const schoolRule = { name: 'School: printers', protocol: 'tcp' as const, remoteAddress: '192.168.1.5', remotePorts: [9100] };

/** A lab computer as the school left it: some values already set, its own firewall rules, public outbound blocked. */
const school = (): SystemState => ({
  registry: {
    [`${POLICIES}\\Explorer\\NoWinKeys`]: 0,
    [`${POLICIES}\\Explorer\\NoRun`]: 1,
    'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System\\AllowClipboardHistory': 1,
    'HKLM\\SOFTWARE\\School\\Asset': 'LAB-07',
  },
  firewall: { outbound: { domain: 'allow', private: 'allow', public: 'block' }, rules: { 'School: printers': schoolRule } },
  explorer: 'running',
});
const thePlan = plan({
  userSid: SID, runId: 'r-1', examMode: 'C:\\Program Files\\ExamMode\\ExamMode.exe', guard: 'C:\\Program Files\\ExamMode\\ExamModeGuard.exe',
  teacher: { address: '192.168.1.20', port: 47800 }, websites: true, profiles: [word],
});
const at = 1_800_000_000_000;

describe('N-04 every change has its undo', () => {
  it('N-04 undo(apply(plan)) leaves every registry value as it was', () => {
    const { state, journal } = lock(school(), thePlan, at);
    expect(state.registry[`${POLICIES}\\System\\DisableTaskMgr`]).toBe(1);
    expect(state.registry[`${POLICIES}\\Explorer\\NoWinKeys`]).toBe(1);
    expect(unlock(state, journal).registry).toEqual(school().registry);
  });
  it('N-04 after unlock the whole computer is as it was: the firewall, the school\'s rules, Explorer', () => {
    const { state, journal } = lock(school(), thePlan, at);
    expect(state.firewall.outbound).toEqual({ domain: 'block', private: 'block', public: 'block' });
    expect(Object.keys(state.firewall.rules)).toHaveLength(6);
    expect(state.firewall.rules['School: printers']).toEqual(schoolRule);
    expect(state.explorer).toBe('stopped');
    expect(unlock(state, journal)).toEqual(school());
  });
  it.each(thePlan.map((change) => [`${change.kind} ${change.target}`, change] as const))('%s: applied, then undone', (_, change) => {
    const entry = record(school(), change, 1, at);
    const after = apply(school(), change);
    expect(read(after, change)).toEqual(change.after);
    expect(undo(after, entry)).toEqual(school());
  });
  it('a value that did not exist is deleted again, not left empty', () => {
    const change: Change = { kind: 'registry', target: `${POLICIES}\\System\\DisableTaskMgr`, after: 1 };
    const undone = undo(apply(school(), change), record(school(), change, 1, at));
    expect(`${POLICIES}\\System\\DisableTaskMgr` in undone.registry).toBe(false);
  });
  it('a firewall rule of ours left by an earlier crash is replaced, and put back as it was', () => {
    const stale = { name: 'ExamMode: the teacher', protocol: 'tcp' as const, remoteAddress: '10.0.0.9', remotePorts: [47800] };
    const start = school();
    start.firewall.rules[stale.name] = stale;
    const { state, journal } = lock(start, thePlan, at);
    expect(state.firewall.rules[stale.name]?.remoteAddress).toBe('192.168.1.20');
    expect(unlock(state, journal).firewall.rules[stale.name]).toEqual(stale);
  });
  it('an Explorer that was already stopped is not started by the undo', () => {
    const start: SystemState = { ...school(), explorer: 'stopped' };
    const { state, journal } = lock(start, thePlan, at);
    expect(unlock(state, journal).explorer).toBe('stopped');
  });
  it('lock and unlock do not change the state they were given', () => {
    const start = school();
    const { state, journal } = lock(start, thePlan, at);
    unlock(state, journal);
    expect(start).toEqual(school());
  });
});

describe('D9 the journal', () => {
  it('each entry holds what was there before, what was set, and when; ids count up', () => {
    const { journal } = lock(school(), thePlan, at);
    expect(journal).toHaveLength(thePlan.length);
    expect(journal.map((e) => e.id)).toEqual(thePlan.map((_, i) => i + 1));
    const noRun = journal.find((e) => e.target === `${POLICIES}\\Explorer\\NoRun`);
    expect(noRun).toEqual({ id: noRun!.id, kind: 'registry', target: `${POLICIES}\\Explorer\\NoRun`, before: 1, after: 1, at });
    expect(journal.find((e) => e.target === `${POLICIES}\\System\\DisableTaskMgr`)?.before).toBeNull();
    expect(journal.find((e) => e.kind === 'firewallOutbound' && e.target === 'public')?.before).toBe('block');
  });
  it('N-04 entries are undone in reverse order: two changes to one value end at the first before', () => {
    const target = 'HKLM\\SOFTWARE\\School\\Asset';
    const journal = [
      { id: 1, kind: 'registry' as const, target, before: 'LAB-07', after: 'first', at },
      { id: 2, kind: 'registry' as const, target, before: 'first', after: 'second', at },
    ];
    const changed = { ...school(), registry: { ...school().registry, [target]: 'second' } };
    expect(unlock(changed, journal).registry[target]).toBe('LAB-07');
    expect(unlock(changed, [...journal].reverse()).registry[target]).toBe('first');
  });
  it('N-04 a change that was journaled but never made is undone without harm', () => {
    const { state, journal } = lock(school(), thePlan.slice(0, 5), at);
    const notMade = record(state, thePlan[5]!, 6, at);
    expect(unlock(state, [...journal, notMade])).toEqual(school());
  });
  it('the journal is written one entry a line, and read back the same', () => {
    const { journal } = lock(school(), thePlan, at);
    const text = journal.map(serialize).join('');
    expect(text.split('\n')).toHaveLength(journal.length + 1);
    expect(parseJournal(text)).toEqual({ entries: journal, damaged: false });
  });
  it('N-04 a half-written last entry is left out: its change was never made', () => {
    const { state, journal } = lock(school(), thePlan, at);
    const text = journal.map(serialize).join('');
    const cut = parseJournal(text.slice(0, -40));
    expect(cut.damaged).toBe(true);
    expect(cut.entries).toEqual(journal.slice(0, -1));
    // Explorer's stop was the last entry: with it left out, the undo puts everything else back
    expect(unlock({ ...state, explorer: 'running' }, cut.entries)).toEqual(school());
  });
  it('a line that is not an entry is left out and reported', () => {
    const { journal } = lock(school(), thePlan.slice(0, 2), at);
    const text = `${serialize(journal[0]!)}{"id":"x"}\nnot json\n\n${serialize(journal[1]!)}`;
    expect(parseJournal(text)).toEqual({ entries: journal, damaged: true });
  });
  it('an empty journal has nothing to undo', () => {
    expect(parseJournal('')).toEqual({ entries: [], damaged: false });
    expect(unlock(school(), [])).toEqual(school());
  });
});
