/**
 * The process guard's question for every window that appears: may it stay? (F-12, architecture §2.5.)
 * Pure: the caller — the guard loop in src/main/student — gathers the facts and closes what this says to close.
 */
import { expand, fileName, matches, under, type Env, type ProcInfo } from '../profiles/match';
import type { AppProfile } from '../profiles/schema';
import type { NameList, SystemList } from './lists';

export interface GuardContext {
  /** the exam's apps: profiles, and apps added by their .exe */
  allowed: AppProfile[];
  /** the process's parent, its parent, and so on: the nearest first */
  ancestors: ProcInfo[];
  always: SystemList;
  env: Env;
  /** the installed ExamMode.exe and ExamModeGuard.exe (D10) */
  self: string[];
}

export type Decision =
  | { allow: true; why: 'system' | 'examMode' | 'background' }
  | { allow: true; why: 'profile' | 'child'; profile: string }
  | { allow: false; why: 'notAllowed' | 'alwaysClose'; kind: 'app' | 'remote' | 'browser' };

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const on = (list: NameList, file: string, product: string) => list.files.some((f) => sameText(f, file)) || list.products.some((p) => sameText(p, product));

function isSystem(proc: ProcInfo, image: string, { always: { system }, env }: GuardContext): boolean {
  const root = expand('%SystemRoot%', env);
  if (root === null || proc.signer !== system.signer || !under(image, root)) return false;
  return system.files.some((f) => sameText(f, fileName(image))) || system.folders.some((folder) => under(image, `${root}\\${folder}`));
}

export function decide(proc: ProcInfo, ctx: GuardContext): Decision {
  const { image } = proc;
  if (image !== null) {
    // 1. Windows' own processes
    if (isSystem(proc, image, ctx)) return { allow: true, why: 'system' };
    // 2. ExamMode itself
    if (ctx.self.some((exe) => sameText(exe, image))) return { allow: true, why: 'examMode' };
    // 3. an allowed app
    const profile = ctx.allowed.find((p) => matches(proc, p, ctx.env));
    if (profile) return { allow: true, why: 'profile', profile: profile.id };
  }
  const file = image === null ? '' : fileName(image);
  const product = proc.product ?? '';
  const kind = on(ctx.always.browsers, file, product) ? 'browser' : on(ctx.always.remote, file, product) ? 'remote' : 'app';
  // 4. started by an allowed app that may start it — never a browser or a remote tool, whatever its name
  const parent = kind === 'app' ? startedBy(ctx) : undefined;
  if (parent?.children.allow.some((child) => sameText(child, file))) return { allow: true, why: 'child', profile: parent.id };
  // 5. anything else with a window is closed; in the background, only what is on the always-close list
  if (proc.hasWindow) return { allow: false, why: 'notAllowed', kind };
  if (kind === 'remote' || on(ctx.always.ai, file, product) || on(ctx.always.recorders, file, product)) return { allow: false, why: 'alwaysClose', kind };
  return { allow: true, why: 'background' };
}

/** The allowed app that started this process: the nearest ancestor that matches a profile. */
function startedBy(ctx: GuardContext): AppProfile | undefined {
  for (const ancestor of ctx.ancestors) {
    const profile = ctx.allowed.find((p) => matches(ancestor, p, ctx.env));
    if (profile) return profile;
  }
  return undefined;
}

/** A process's parent, its parent, and so on, from one list of the computer's processes. */
export function ancestorsOf(proc: ProcInfo, all: ProcInfo[]): ProcInfo[] {
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const seen = new Set([proc.pid]);
  const chain: ProcInfo[] = [];
  for (let parent = byPid.get(proc.parentPid); parent && !seen.has(parent.pid); parent = byPid.get(parent.parentPid)) {
    seen.add(parent.pid);
    chain.push(parent);
  }
  return chain;
}
