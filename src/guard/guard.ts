/**
 * The Guard's rules (architecture §2.4 step 3, D9, N-04, F-20), without Windows: the journal on disk, and what is
 * done with it. Every change is written down *before* it is made and undone in reverse order — on unlock, when
 * ExamMode's process ends without unlocking, and at every start of the Guard (so: at every boot). What changes a
 * computer is a `System`: real Windows in the service (src/win), plain data in the tests.
 */
import { appendFile, open, readFile, rm, writeFile } from 'node:fs/promises';
import { parseJournal, serialize, type Change, type JournalEntry } from '@lib/lockdown/journal';
import { PROTOCOL_VERSION, type Stopped } from '@lib/protocol/messages';

/** The parts of a computer the lockdown changes: what a target is now, and making a change. */
export interface System {
  read(target: Pick<Change, 'kind' | 'target'>): Promise<JournalEntry['before']>;
  apply(change: Change): Promise<void>;
}

/** The ExamMode the Guard watches, and what to tell the teacher's laptop if it stops (§2.7). */
export interface Watched { pid: number; runId: string; token: string; instanceId: string; pc: string; teacher: { host: string; port: number } }

export interface GuardOptions {
  /** the journal: C:\ProgramData\ExamMode\journal.json */
  journal: string;
  system: System;
  now?: () => number;
  /** is this process still running? */
  alive?: (pid: number) => boolean;
  /** tells the teacher's laptop that ExamMode stopped (HTTP POST /stopped) */
  report?: (watched: Watched, stopped: Stopped) => Promise<void>;
  /** starts ExamMode again in the student's session, to say why it is locked out (screen 10) */
  relaunch?: (runId: string) => Promise<void>;
  /** how often the watched process is looked at */
  watchMs?: number;
}

export type Answer = { ok: true } | { ok: false; why: 'locked' | 'secret' | 'failed'; detail?: string };

export class Guard {
  private secret?: string;
  private watched?: Watched;
  private timer?: NodeJS.Timeout;
  private busy: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly options: GuardOptions) {
    this.now = options.now ?? Date.now;
  }

  /** At every start of the Guard: a journal that is still there is undone. A computer is never left locked with
   *  nobody to unlock it. Answers how many changes were undone. */
  recover(): Promise<number> {
    return this.inTurn(async () => {
      const entries = await this.entries();
      await this.undo(entries);
      return entries.length;
    });
  }

  async status(): Promise<{ locked: boolean; changes: number; watching?: number }> {
    const entries = await this.entries();
    return { locked: entries.length > 0, changes: entries.length, watching: this.watched?.pid };
  }

  /** Locks: each change journaled, then made. `secret` is the caller's: only who knows it may unlock. If a change
   *  can't be made, the ones before it are undone: all or nothing. */
  lock(plan: Change[], secret: string): Promise<Answer> {
    return this.inTurn(async () => {
      if ((await this.entries()).length > 0) return { ok: false, why: 'locked' };
      const journal: JournalEntry[] = [];
      try {
        for (const change of plan) {
          const before = await this.options.system.read(change);
          // nothing to do, and so nothing to undo
          if (JSON.stringify(before) === JSON.stringify(change.after)) continue;
          const entry = { ...change, id: journal.length + 1, before, at: this.now() } as JournalEntry;
          await this.write(entry);
          journal.push(entry);
          await this.options.system.apply(change);
        }
      } catch (error) {
        await this.undo(journal);
        return { ok: false, why: 'failed', detail: String(error) };
      }
      this.secret = secret;
      return { ok: true };
    });
  }

  /** Unlocks (hand-in, leave, the end): every change undone, the last first. */
  unlock(secret: string): Promise<Answer> {
    return this.inTurn(async () => {
      const entries = await this.entries();
      if (entries.length > 0 && secret !== this.secret) return { ok: false, why: 'secret' };
      this.forget();
      const left = await this.undo(entries);
      return left === 0 ? { ok: true } : { ok: false, why: 'failed', detail: `${left} changes couldn't be undone yet` };
    });
  }

  /** Watches ExamMode's process: if it ends without unlocking, that is *stopped suddenly* (F-20). */
  watch(watched: Watched, secret: string): Answer {
    if (secret !== this.secret) return { ok: false, why: 'secret' };
    this.watched = watched;
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.look(), this.options.watchMs ?? 500);
    return { ok: true };
  }

  /** One look at the watched process. Gone without unlocking: the teacher is told, the computer is put back, and
   *  ExamMode is started again to say why (§2.4). */
  look(): Promise<void> {
    return this.inTurn(async () => {
      const watched = this.watched;
      if (!watched || (this.options.alive ?? alive)(watched.pid)) return;
      this.forget();
      const stopped: Stopped = { v: PROTOCOL_VERSION, type: 'stopped', token: watched.token, pc: watched.pc, instanceId: watched.instanceId, at: this.now() };
      // the computer is put back whether or not the teacher's laptop could be told
      await this.options.report?.(watched, stopped).catch(() => undefined);
      await this.undo(await this.entries());
      await this.options.relaunch?.(watched.runId).catch(() => undefined);
    });
  }

  stop(): void {
    clearInterval(this.timer);
  }

  // ── inside ────────────────────────────────────────────────────────────────────────────────────────────────────

  private forget(): void {
    clearInterval(this.timer);
    this.watched = undefined;
    this.secret = undefined;
  }

  private async entries(): Promise<JournalEntry[]> {
    const text = await readFile(this.options.journal, 'utf8').catch(() => '');
    return parseJournal(text).entries;
  }

  /** An entry is on the disk for good before its change is made. */
  private async write(entry: JournalEntry): Promise<void> {
    await appendFile(this.options.journal, serialize(entry));
    const file = await open(this.options.journal, 'r+');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  }

  /** Undoes entries, the last first. One that can't be undone now stays in the journal for the next try; the
   *  others are still undone. Answers how many stay. */
  private async undo(entries: JournalEntry[]): Promise<number> {
    const stay: JournalEntry[] = [];
    for (const entry of [...entries].reverse()) {
      try {
        await this.options.system.apply({ kind: entry.kind, target: entry.target, after: entry.before } as Change);
      } catch {
        stay.unshift(entry);
      }
    }
    if (stay.length === 0) await rm(this.options.journal, { force: true });
    else await writeFile(this.options.journal, stay.map(serialize).join(''));
    return stay.length;
  }

  /** One thing at a time: a lock, an unlock and the watchdog never cross. */
  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const done = this.busy.then(work);
    this.busy = done.catch(() => undefined);
    return done;
  }
}

/** Is a process running? (Signal 0 asks without sending anything.) */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // no such process; EPERM would mean it is there but not ours to signal
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
