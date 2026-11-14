/**
 * The process guard's loop (F-12, N-02, architecture §2.5): every half second, every process is asked of
 * `decide()` (src/lib/guard); what may not stay is closed, and the student and the teacher are told. What decides
 * is pure; this gathers the facts and closes.
 */
import { appName } from '@lib/lockdown/checks';
import { ancestorsOf, decide, type Decision, type GuardContext } from '@lib/guard/decide';
import type { ProcInfo } from '@lib/profiles/match';

export type Proc = ProcInfo & { titles: string[] };

/** The computer's processes, as the loop needs them (src/win/processes.ts; a fake in the tests). */
export interface Procs {
  /** every process. `withFacts`: with who made each program, which costs a second for a program not seen before */
  list(withFacts: boolean): Promise<Proc[]>;
  /** is who made this program known already? */
  known(image: string): boolean;
  terminate(pid: number): Promise<boolean>;
}

export interface Closed { name: string; kind: 'app' | 'remote' | 'browser'; pid: number; at: number }
export type Context = Omit<GuardContext, 'ancestors'>;

export const SWEEP_MS = 500;

export class ProcessGuard {
  private timer?: NodeJS.Timeout;
  private sweeping = false;
  private readonly closed = new Set<number>();

  /** `onSweep`: told every process after each look — the lock uses it to say which of the exam's apps are open */
  constructor(
    private readonly procs: Procs, private readonly ctx: Context, private readonly onClosed: (closed: Closed) => void,
    private readonly now: () => number = Date.now, private readonly onSweep?: (all: Proc[]) => void,
  ) {}

  start(everyMs = SWEEP_MS): void {
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), everyMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One look at every process. Answers how many were closed. */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      let all = await this.procs.list(false);
      // A program not seen before: who made it isn't known yet. If no publisher could make it allowed, it is
      // closed at once (N-02); otherwise the publisher is asked for first — an allowed app is never closed by guess
      const waiting = all.filter((p) => p.image !== null && !this.procs.known(p.image) && this.matters(p, all));
      let count = 0;
      for (const proc of waiting.filter((p) => !this.couldStay(p, all))) count += await this.close(proc, all);
      if (waiting.some((p) => this.couldStay(p, all))) all = await this.procs.list(true);
      for (const proc of all) count += await this.close(proc, all);
      this.onSweep?.(all.filter((p) => !this.closed.has(p.pid)));
      return count;
    } finally {
      this.sweeping = false;
    }
  }

  private judge(proc: Proc, all: Proc[]): Decision {
    return decide(proc, { ...this.ctx, ancestors: ancestorsOf(proc, all) });
  }

  /** Would this process be closed, as far as is known now? */
  private matters(proc: Proc, all: Proc[]): boolean {
    return !this.closed.has(proc.pid) && !this.judge(proc, all).allow;
  }

  /** Could any publisher make this program one that may stay? */
  private couldStay(proc: Proc, all: Proc[]): boolean {
    const publishers = [this.ctx.always.system.signer, ...this.ctx.allowed.map((p) => p.match.signer)];
    return publishers.some((signer) => this.judge({ ...proc, signer }, all).allow);
  }

  private async close(proc: Proc, all: Proc[]): Promise<number> {
    if (this.closed.has(proc.pid)) return 0;
    const decision = this.judge(proc, all);
    if (decision.allow) return 0;
    this.closed.add(proc.pid);
    if (!(await this.procs.terminate(proc.pid))) return 0;
    this.onClosed({ name: appName(proc), kind: decision.kind, pid: proc.pid, at: this.now() });
    return 1;
  }
}
