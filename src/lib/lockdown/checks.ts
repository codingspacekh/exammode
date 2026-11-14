/**
 * The computer's checks before an exam may start (F-04, F-05, architecture §2.4 step 1): one screen, no remote
 * control, not a virtual machine — and the apps that will be closed, listed first so that a student can save.
 * Pure: the caller gathers the facts.
 */
import { ancestorsOf, decide, type GuardContext } from '../guard/decide';
import { fileName, type ProcInfo } from '../profiles/match';

export interface Machine { manufacturer: string; model: string; bios: string }
export type CheckName = 'guard' | 'oneScreen' | 'noRemote' | 'realComputer';
export interface Check { check: CheckName; ok: boolean; /** what was found, for the screen and the teacher's list */ found?: string }

export interface CheckFacts {
  /** can ExamMode Guard be reached? Without it the computer can't be locked */
  guard: boolean;
  displays: number;
  /** this computer is being used over Remote Desktop */
  remoteSession: boolean;
  /** remote-control apps that are running, by name */
  remoteTools: string[];
  machine: Machine;
  /** a development build may run in a virtual machine (MILESTONES §1.10) */
  allowVirtual?: boolean;
}

const MAKERS: [RegExp, string][] = [
  [/vmware/i, 'VMware'], [/virtualbox|innotek/i, 'VirtualBox'], [/qemu|bochs|kvm/i, 'QEMU'], [/parallels/i, 'Parallels'], [/xen/i, 'Xen'],
  // Hyper-V calls its guests "Virtual Machine", made by Microsoft Corporation; a Surface is Microsoft's too
  [/^microsoft corporation virtual machine/i, 'Hyper-V'], [/virtual machine|hyper-v/i, 'a virtual machine'],
];

/** The kind of virtual machine this is, if it is one. */
export function virtualMachine(m: Machine): string | undefined {
  const text = `${m.manufacturer} ${m.model} ${m.bios}`;
  return MAKERS.find(([pattern]) => pattern.test(text))?.[1];
}

export function runChecks(facts: CheckFacts): { checks: Check[]; ok: boolean } {
  const vm = virtualMachine(facts.machine);
  const remote = [...(facts.remoteSession ? ['Remote Desktop'] : []), ...facts.remoteTools];
  const checks: Check[] = [
    { check: 'guard', ok: facts.guard },
    { check: 'oneScreen', ok: facts.displays === 1, found: facts.displays === 1 ? undefined : `${facts.displays} screens` },
    { check: 'noRemote', ok: remote.length === 0, found: remote.join(', ') || undefined },
    { check: 'realComputer', ok: vm === undefined || facts.allowVirtual === true, found: vm },
  ];
  return { checks, ok: checks.every((c) => c.ok) };
}

/** An app that isn't part of the exam and has a window: it will be closed (F-05). */
export interface AppToClose { name: string; pids: number[]; windows: number; /** a file that isn't saved, from a window's title */ unsaved?: string }

/** What a program calls itself: its product name, else its file name without `.exe`. Windows' own tools all
 *  call themselves *Microsoft® Windows® Operating System*, so those go by their file too. */
export function appName(proc: Pick<ProcInfo, 'image' | 'product'>): string {
  const product = proc.product?.trim();
  if (product && !/operating system/i.test(product)) return product;
  return proc.image ? fileName(proc.image).replace(/\.exe$/i, '') : product || 'A program';
}

/** A title that says its file isn't saved: `*notes.txt - Notepad`, `● main.py - Visual Studio Code`. */
export function unsavedIn(title: string): string | undefined {
  const marked = /^\s*[*•●]\s*(.+)$/.exec(title) ?? /^(.+?)\s*[*•●]\s*(?: [-—–] .*)?$/.exec(title);
  if (!marked) return undefined;
  return marked[1]!.split(/ [-—–] /)[0]!.trim() || undefined;
}

type Windowed = ProcInfo & { titles: string[] };

/** The apps that will be closed, by name: every process with a window that the process guard wouldn't let stay. */
export function appsToClose(procs: Windowed[], ctx: Omit<GuardContext, 'ancestors'>): AppToClose[] {
  const apps = new Map<string, AppToClose>();
  for (const proc of procs) {
    if (!proc.hasWindow || decide(proc, { ...ctx, ancestors: ancestorsOf(proc, procs) }).allow) continue;
    const name = appName(proc);
    const app = apps.get(name) ?? { name, pids: [], windows: 0 };
    app.pids.push(proc.pid);
    app.windows += proc.titles.filter((t) => t.trim() !== '').length || 1;
    app.unsaved ??= proc.titles.map(unsavedIn).find(Boolean);
    apps.set(name, app);
  }
  return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
}
