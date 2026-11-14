/**
 * Locking a real lab computer (architecture §2.4, §2.5): the checks through Windows, the lock through the Guard,
 * and — while the exam runs — the process guard's loop and the keyboard hook in ExamMode itself. Windows glue:
 * its parts are proven one by one by the windows tests, and together by the windows e2e test.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { LISTS } from '@lib/guard/lists';
import { appName, appsToClose, runChecks } from '@lib/lockdown/checks';
import type { Change } from '@lib/lockdown/journal';
import { plan } from '@lib/lockdown/plan';
import { fileName, matches } from '@lib/profiles/match';
import type { AppProfile } from '@lib/profiles/schema';
import { GUARD, GuardClient, type Endpoint } from '../../guard/pipe';
import { KeyboardHook } from '../../win/keyboard';
import { factsKnown, focus, foregroundPid, listProcesses, machine, remoteSession, terminate } from '../../win/processes';
import { run } from '../../win/run';
import { launch } from './launcher';
import type { Checked, LockEvents, LockInfo, Lockdown, OpenApp } from './lockdown';
import { ProcessGuard, type Context, type Proc } from './process-guard';

export interface WindowsLockdownOptions {
  /** this ExamMode's own program, and the Guard's (D10) */
  examMode: string;
  guard: string;
  /** how many screens are plugged in */
  displays: () => number;
  clearClipboard: () => void;
  /** where each app's own settings for the exam are kept, outside the Exam folder */
  profiles: string;
  endpoint?: Endpoint;
  /** a development build may run in a virtual machine */
  allowVirtual?: boolean;
  /** development and tests only: programs that are left alone as if they were ExamMode's own, and programs that
   *  stay reachable through the firewall (GitHub's runner) */
  alsoAllow?: string[];
  keepReachable?: string[];
}

const WHY: Record<string, string> = {
  locked: 'This computer is still locked from an exam that didn\'t end. Restart it, then join again.',
  notExamMode: 'ExamMode Guard doesn\'t know this ExamMode. Tell your teacher.',
  invalid: 'ExamMode Guard and this ExamMode aren\'t the same version. Tell your teacher.',
  secret: 'ExamMode Guard refused. Tell your teacher.',
};

export class WindowsLockdown implements Lockdown {
  private readonly client: GuardClient;
  private readonly keyboard = new KeyboardHook();
  private guardLoop?: ProcessGuard;
  private secret?: string;
  private info?: LockInfo;
  /** the exam's apps that are open, by profile: their processes */
  private open = new Map<string, number[]>();
  private told = '';

  constructor(private readonly options: WindowsLockdownOptions) {
    this.client = new GuardClient(options.endpoint ?? GUARD);
  }

  /** What the process guard is told: Windows, ExamMode itself, and the exam's apps may stay. */
  private context(apps: AppProfile[] = this.info?.apps ?? []): Context {
    const { examMode, guard, alsoAllow = [] } = this.options;
    return { allowed: apps, always: LISTS, env: process.env as Record<string, string>, self: [examMode, guard, ...alsoAllow] };
  }

  async check(): Promise<Checked> {
    const guard = await this.client.ask({ type: 'status' }).then((reply) => reply.ok, () => false);
    const procs = await listProcesses(true);
    const isRemote = (p: (typeof procs)[number]) => p.image !== null
      && (LISTS.remote.files.some((f) => f.toLowerCase() === fileName(p.image!).toLowerCase()) || LISTS.remote.products.some((n) => n.toLowerCase() === (p.product ?? '').toLowerCase()));
    const checked = runChecks({
      guard, displays: this.options.displays(), remoteSession: await remoteSession(), remoteTools: [...new Set(procs.filter(isRemote).map(appName))],
      machine: await machine(), allowVirtual: this.options.allowVirtual,
    });
    return { ...checked, toClose: appsToClose(procs, this.context()) };
  }

  async lock(info: LockInfo, events: LockEvents): Promise<string | undefined> {
    const ctx = this.context(info.apps);
    // F-05: the apps that were listed are closed now
    for (const app of appsToClose(await listProcesses(true), ctx)) for (const pid of app.pids) await terminate(pid);
    this.options.clearClipboard();

    const sid = /"(S-1-[\d-]+)"/.exec((await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'])).out)?.[1];
    if (!sid) return 'This account can\'t be read. Tell your teacher.';
    // the firewall takes addresses, not names
    const address = await lookup(info.teacher.host, { family: 4 }).then((found) => found.address, () => info.teacher.host);
    const { examMode, guard, keepReachable = [] } = this.options;
    let changes = plan({ userSid: sid, runId: info.runId, examMode, guard, teacher: { address, port: info.teacher.port }, websites: info.websites, profiles: info.apps });
    if (keepReachable.length > 0) {
      const extra = keepReachable.map((program, i): Change => ({ kind: 'firewallRule', target: `ExamMode: kept reachable ${i + 1}`, after: { name: `ExamMode: kept reachable ${i + 1}`, program, protocol: 'tcp' } }));
      const at = changes.findIndex((c) => c.kind === 'firewallState');
      changes = [...changes.slice(0, at), ...extra, ...changes.slice(at)];
    }

    const secret = randomBytes(24).toString('base64url');
    const locked = await this.client.ask({ type: 'lock', plan: changes, secret }).catch((error: unknown) => ({ ok: false as const, why: 'failed' as const, detail: String(error) }));
    if (!locked.ok) return WHY[locked.why] ?? `This computer couldn't be locked${'detail' in locked && locked.detail ? ` (${locked.detail})` : ''}. Tell your teacher.`;
    this.secret = secret;
    this.info = info;
    try {
      await this.client.ask({ type: 'watch', secret, runId: info.runId, token: info.token, instanceId: info.instanceId, pc: info.pc, teacher: info.teacher });
      await this.keyboard.start();
    } catch (error) {
      await this.unlock();
      return `This computer couldn't be locked (${String(error)}). Tell your teacher.`;
    }
    this.guardLoop = new ProcessGuard({ list: listProcesses, known: factsKnown, terminate }, ctx, events.closed, Date.now, (all) => void this.lookAtApps(all, events));
    this.guardLoop.start();
    return undefined;
  }

  /** After each look at the processes: which of the exam's apps are open, and which is in front. */
  private async lookAtApps(all: Proc[], events: LockEvents): Promise<void> {
    const env = process.env as Record<string, string>;
    const front = await foregroundPid();
    const open: OpenApp[] = [];
    this.open = new Map();
    for (const app of this.info?.apps ?? []) {
      const procs = all.filter((p) => matches(p, app, env));
      const windowed = procs.filter((p) => p.hasWindow);
      if (windowed.length === 0) continue;
      this.open.set(app.id, procs.map((p) => p.pid));
      const inFront = windowed.find((p) => p.pid === front);
      open.push({ id: app.id, front: inFront !== undefined, title: (inFront ?? windowed[0]!).titles.find((t) => t.trim() !== '') });
    }
    const said = JSON.stringify(open);
    if (said === this.told) return;
    this.told = said;
    events.apps(open);
  }

  async openApp(id: string): Promise<'notInstalled' | 'failed' | undefined> {
    const info = this.info;
    const app = info?.apps.find((a) => a.id === id);
    if (!info || !app) return 'failed';
    const running = this.open.get(id);
    if (running?.length) return (await focus(running)) ? undefined : 'failed';
    return launch(app, { examFolder: info.examFolder, examProfile: join(this.options.profiles, info.runId, id.replace(/[^\w.-]/g, '_')) }, {
      env: process.env as Record<string, string>,
      exists: (path) => access(path).then(() => true, () => false),
      list: (folder) => readdir(folder).catch(() => []),
      // `start /max`: maximised — under the exam bar, as the work area ends there
      start: async (exe, args, folder) => void spawn('cmd.exe', ['/c', 'start', '', '/max', '/d', folder, exe, ...args], { detached: true, stdio: 'ignore', windowsHide: true }).unref(),
    });
  }

  /** The exam bar's window, for the keys that are swallowed only on it. */
  setBar(hwnd: bigint): void {
    this.keyboard.setBar(hwnd);
  }

  async unlock(): Promise<void> {
    this.guardLoop?.stop();
    this.guardLoop = undefined;
    // the exam's apps are closed with the exam, and their exam settings removed
    for (const pids of this.open.values()) for (const pid of pids) await terminate(pid).catch(() => false);
    this.open = new Map();
    this.told = '';
    const runId = this.info?.runId;
    this.info = undefined;
    if (runId) await rm(join(this.options.profiles, runId), { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    await this.keyboard.stop().catch(() => undefined);
    const secret = this.secret;
    this.secret = undefined;
    if (secret) await this.client.ask({ type: 'unlock', secret }).catch(() => undefined);
    this.options.clearClipboard();
  }
}
