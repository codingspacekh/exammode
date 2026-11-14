/**
 * Locking a real lab computer (architecture §2.4, §2.5): the checks through Windows, the lock through the Guard,
 * and — while the exam runs — the process guard's loop and the keyboard hook in ExamMode itself. Windows glue:
 * its parts are proven one by one by the windows tests, and together by the windows e2e test.
 */
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { LISTS } from '@lib/guard/lists';
import { appName, appsToClose, runChecks } from '@lib/lockdown/checks';
import type { Change } from '@lib/lockdown/journal';
import { plan } from '@lib/lockdown/plan';
import { fileName } from '@lib/profiles/match';
import { GUARD, GuardClient, type Endpoint } from '../../guard/pipe';
import { KeyboardHook } from '../../win/keyboard';
import { factsKnown, listProcesses, machine, remoteSession, terminate } from '../../win/processes';
import { run } from '../../win/run';
import type { Checked, LockInfo, Lockdown } from './lockdown';
import { ProcessGuard, type Context } from './process-guard';

export interface WindowsLockdownOptions {
  /** this ExamMode's own program, and the Guard's (D10) */
  examMode: string;
  guard: string;
  /** how many screens are plugged in */
  displays: () => number;
  clearClipboard: () => void;
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

  constructor(private readonly options: WindowsLockdownOptions) {
    this.client = new GuardClient(options.endpoint ?? GUARD);
  }

  /** What the process guard is told: nothing is allowed but Windows and ExamMode itself (the exam's apps: M5). */
  private context(): Context {
    const { examMode, guard, alsoAllow = [] } = this.options;
    return { allowed: [], always: LISTS, env: process.env as Record<string, string>, self: [examMode, guard, ...alsoAllow] };
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

  async lock(info: LockInfo, onClosed: (app: { name: string; kind: string }) => void): Promise<string | undefined> {
    const ctx = this.context();
    // F-05: the apps that were listed are closed now
    for (const app of appsToClose(await listProcesses(true), ctx)) for (const pid of app.pids) await terminate(pid);
    this.options.clearClipboard();

    const sid = /"(S-1-[\d-]+)"/.exec((await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'])).out)?.[1];
    if (!sid) return 'This account can\'t be read. Tell your teacher.';
    // the firewall takes addresses, not names
    const address = await lookup(info.teacher.host, { family: 4 }).then((found) => found.address, () => info.teacher.host);
    const { examMode, guard, keepReachable = [] } = this.options;
    let changes = plan({ userSid: sid, runId: info.runId, examMode, guard, teacher: { address, port: info.teacher.port }, websites: info.websites, profiles: [] });
    if (keepReachable.length > 0) {
      const extra = keepReachable.map((program, i): Change => ({ kind: 'firewallRule', target: `ExamMode: kept reachable ${i + 1}`, after: { name: `ExamMode: kept reachable ${i + 1}`, program, protocol: 'tcp' } }));
      const at = changes.findIndex((c) => c.kind === 'firewallState');
      changes = [...changes.slice(0, at), ...extra, ...changes.slice(at)];
    }

    const secret = randomBytes(24).toString('base64url');
    const locked = await this.client.ask({ type: 'lock', plan: changes, secret }).catch((error: unknown) => ({ ok: false as const, why: 'failed' as const, detail: String(error) }));
    if (!locked.ok) return WHY[locked.why] ?? `This computer couldn't be locked${'detail' in locked && locked.detail ? ` (${locked.detail})` : ''}. Tell your teacher.`;
    this.secret = secret;
    try {
      await this.client.ask({ type: 'watch', secret, runId: info.runId, token: info.token, instanceId: info.instanceId, pc: info.pc, teacher: info.teacher });
      await this.keyboard.start();
    } catch (error) {
      await this.unlock();
      return `This computer couldn't be locked (${String(error)}). Tell your teacher.`;
    }
    this.guardLoop = new ProcessGuard({ list: listProcesses, known: factsKnown, terminate }, ctx, onClosed);
    this.guardLoop.start();
    return undefined;
  }

  /** The exam bar's window, for the keys that are swallowed only on it. */
  setBar(hwnd: bigint): void {
    this.keyboard.setBar(hwnd);
  }

  async unlock(): Promise<void> {
    this.guardLoop?.stop();
    this.guardLoop = undefined;
    await this.keyboard.stop().catch(() => undefined);
    const secret = this.secret;
    this.secret = undefined;
    if (secret) await this.client.ask({ type: 'unlock', secret }).catch(() => undefined);
    this.options.clearClipboard();
  }
}
