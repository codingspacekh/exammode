/**
 * A run on the teacher's laptop (architecture §2.3, §2.7, §2.8, D5): the rules of src/lib/session wired to the
 * messages of the protocol. It knows nothing about sockets: a student's connection is a `Link`, and the server
 * (server.ts) hands it what arrives. Everything that changes is written to the store as it happens (N-05) and told
 * to whoever listens (the live view, N-03).
 */
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { folderName, isSafeName, studentFolders } from '@lib/files/names';
import { receiptCode } from '@lib/files/receipt';
import { PROTOCOL_VERSION, type FileMeta, type FromStudent, type FromTeacher, type RefusedReason, type Stopped, type Upload } from '@lib/protocol/messages';
import {
  addTime, onBeat, onChecks, onEvent, onHandIn, onJoin, onKeepOut, onLeave, onLetBackIn, onReady, onResume, onStart, onStopped, onTick,
  type Attempt, type HandInHow, type Result,
} from '@lib/session/attempt';
import { endsAt } from '@lib/session/time';
import type { RunView, StudentView } from '@lib/app/state';
import type { CheckName } from '@lib/lockdown/checks';
import { place, setAside, type Received } from './handIns';
import type { ExamRow, RunRow, Store, StudentRow } from './store/store';

/** A student's connection, as the classroom sees it. */
export interface Link {
  send(msg: FromTeacher): void;
  close(): void;
  /** the computer's address, for counting wrong codes */
  readonly from?: string;
}

type Join = Extract<FromStudent, { type: 'join' }>;
type Resume = Extract<FromStudent, { type: 'resume' }>;
type Receipt = Extract<FromTeacher, { type: 'receipt' }>;

export type { RunView, StudentView };

export type UploadResult = { ok: true; receipt?: Receipt } | { ok: false; why: 'unknown' | 'refused' | 'mismatch' };

export interface ClassroomOptions {
  /** the Hand-ins folder */
  handIns: string;
  /** the teacher's clock */
  now?: () => number;
  /** where an exam's files to give are kept */
  given?: (examId: string) => string;
}

interface Seat {
  attempt: Attempt;
  /** the attempt's row, once it has one */
  id?: number;
  token?: string;
  receipt?: string;
  link?: Link;
  /** a refused join, still connected, waiting for the teacher */
  waiting?: Link;
  /** how many files the teacher's laptop has from this student */
  files?: number;
  /** told that the time is up, or that the exam was ended */
  toldEnd?: boolean;
}

/** Wrong codes from one computer before it has to wait (F-03): the code has only four digits. */
export const WRONG_CODES = 5;
export const WRONG_CODE_WAIT_MS = 60_000;
/** A hand-in is *time up* when the student was told their time is up, or — with no contact, by their own count —
 *  when it comes this close to the end or after it: the student's clock is only nearly the teacher's. */
const TIME_UP_SLACK_MS = 2000;
/** Hand-ins and the run's own changes are on the disk for good within this long. */
const FLUSH_MS = 50;
/** In a student's folder: backups of files that weren't in the hand-in. */
export const EARLIER = 'Earlier backups';

const newToken = (): string => randomBytes(24).toString('base64url');
export const newCode = (): string => String(randomInt(10_000)).padStart(4, '0');

/** `Year 10 ICT 2026-11-12 0855`: the run's folder in Hand-ins. */
function runFolder(title: string, at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${folderName(title)} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}`;
}

/** What is written to the store: everything but when the student was last heard from and the app in front. */
const kept = (a: Attempt): string => JSON.stringify({ ...a, lastBeatAt: undefined, front: undefined });
const shown = (a: Attempt): string => JSON.stringify({ ...a, lastBeatAt: undefined });

export class Classroom {
  private readonly seats = new Map<string, Seat>();
  private readonly tokens = new Map<string, string>();
  private readonly links = new Map<Link, string>();
  private readonly wrongCodes = new Map<string, { count: number; until: number }>();
  private readonly listeners = new Set<(studentId?: string) => void>();
  private readonly folders: Map<string, string>;
  private readonly roster: Map<string, StudentRow>;
  private readonly now: () => number;
  /** the files every student is given (F-33) */
  private given: FileMeta[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private flushing?: Promise<void>;

  private constructor(
    private readonly store: Store,
    private run: RunRow,
    private readonly exam: ExamRow,
    private readonly className: string,
    students: StudentRow[],
    private readonly options: ClassroomOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.roster = new Map(students.map((s) => [s.id, s]));
    this.folders = studentFolders(students);
  }

  /** Opens a new run of an exam: a code for the board, a folder in Hand-ins. */
  static async create(store: Store, examId: string, options: ClassroomOptions & { code?: string }): Promise<Classroom> {
    const at = (options.now ?? Date.now)();
    const exam = await store.exam(examId);
    if (!exam) throw new Error(`No exam ${examId}`);
    const run = await store.openRun(examId, { code: options.code ?? newCode(), folder: runFolder(exam.title, at), at });
    await store.log(run.id, [{ at, kind: 'runOpened', details: {} }]);
    return Classroom.open(store, run.id, options);
  }

  /** Opens a run from the store: a new one, or one that was open when the teacher's laptop restarted (N-05). */
  static async open(store: Store, runId: string, options: ClassroomOptions): Promise<Classroom> {
    const found = await store.run(runId);
    if (!found) throw new Error(`No run ${runId}`);
    const students = await store.students(found.exam.classId);
    const room = new Classroom(store, found.run, found.exam, found.className, students, options);
    const saved = await store.attempts(runId);
    for (const s of students) {
      const was = saved.get(s.id);
      room.seats.set(s.id, was ? { attempt: was.attempt, id: was.id, token: was.token, receipt: was.receipt } : { attempt: { state: 'notJoined', extraMinutes: 0, warnings: 0 } });
      if (was?.token) room.tokens.set(was.token, s.id);
    }
    for (const [studentId, files] of await store.fileCounts(runId)) room.seats.get(studentId)!.files = files;
    room.given = (await store.examFiles(found.exam.id)).map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }));
    await mkdir(room.folder, { recursive: true });
    return room;
  }

  get id(): string {
    return this.run.id;
  }

  /** The run's folder in Hand-ins. */
  get folder(): string {
    return join(this.options.handIns, this.run.folder);
  }

  /** A student's folder in the run's hand-ins. */
  folderOf(studentId: string): string {
    return join(this.folder, this.folders.get(studentId) ?? studentId);
  }

  /** What the beacon says about this run (F-01); nothing once it has ended. */
  listing(): { runId: string; title: string; teacher: string; class: string; minutes: number } | undefined {
    if (this.run.endedAt !== null) return undefined;
    return { runId: this.run.id, title: this.exam.title, teacher: this.exam.teacher, class: this.className, minutes: this.exam.minutes };
  }

  /** The class list a student picks their name from (F-02): the email only where a name is shared. */
  names(): { id: string; name: string; email?: string }[] {
    const all = [...this.roster.values()];
    const shared = (name: string) => all.filter((s) => s.name === name).length > 1;
    return all.map((s) => (shared(s.name) && s.email ? { id: s.id, name: s.name, email: s.email } : { id: s.id, name: s.name }));
  }

  view(): { run: RunView; students: StudentView[] } {
    const { run, exam } = this;
    return {
      run: {
        id: run.id, code: run.code, title: exam.title, teacher: exam.teacher, className: this.className, minutes: exam.minutes,
        extraMinutes: run.extraMinutes, websites: exam.websites, folder: this.folder, openedAt: run.openedAt,
        startedAt: run.startedAt ?? undefined, endsAt: this.endsAt(), endedAt: run.endedAt ?? undefined,
      },
      students: [...this.roster.values()].map((s) => {
        const seat = this.seat(s.id);
        const a = seat.attempt;
        return {
          id: s.id, name: s.name, state: a.state, pc: a.pc, front: a.front, connected: seat.link !== undefined, warnings: a.warnings,
          extraMinutes: a.extraMinutes, joinedAt: a.joinedAt, endsAt: this.endsAt(a), leftAt: a.leftAt, leftHow: a.leftHow, asksBackFrom: a.asksBack?.pc,
          handedInAt: a.handedInAt, handedInHow: a.handedInHow, receipt: seat.receipt, files: seat.files ?? 0,
          failed: a.state === 'checking' ? (a.checks ?? []).filter((c) => !c.ok).map((c) => c.check as CheckName) : [],
        };
      }),
    };
  }

  /** Told after every change, with the student it was about (none: the run itself). */
  onChange(listener: (studentId?: string) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  // ── from a student ────────────────────────────────────────────────────────────────────────────────────────────

  /** `join`: the code, the name, then the rules of §2.8. A join refused because the student left stays connected
   *  and waits for the teacher. */
  join(msg: Join, link: Link): Promise<void> {
    return this.inTurn(async () => {
      const refuse = (reason: RefusedReason): void => {
        link.send({ v: PROTOCOL_VERSION, type: 'refused', reason });
        link.close();
      };
      if (this.run.endedAt !== null) return refuse('ended');
      if (!this.codeRight(msg.code, link.from)) {
        await this.store.log(this.run.id, [{ pc: msg.pc, at: this.now(), kind: 'codeWrong', details: {} }]);
        this.changed();
        return refuse('codeWrong');
      }
      const seat = this.seats.get(msg.studentId);
      if (!seat) return refuse('notInClass');

      const result = onJoin(seat.attempt, { pc: msg.pc, instanceId: msg.instanceId, bootId: msg.bootId }, this.now());
      if (result.events.some((e) => e.kind === 'joined' || e.kind === 'cameBack')) this.giveToken(msg.studentId);
      await this.apply(msg.studentId, result);
      if (result.reply?.type === 'joined') return this.welcome(msg.studentId, link);
      const reason = result.reply?.type === 'refused' ? result.reply.reason : 'notJoined';
      if (reason !== 'left') return refuse(reason);
      if (seat.waiting !== link) seat.waiting?.close();
      seat.waiting = link;
      const a = seat.attempt;
      link.send({ v: PROTOCOL_VERSION, type: 'refused', reason, left: { at: a.leftAt ?? this.now(), how: a.leftHow ?? 'stoppedSuddenly', pc: a.pc ?? msg.pc } });
    });
  }

  /** `resume`: the same ExamMode, back after a gap, with its own record of it (F-19). */
  resume(msg: Resume, link: Link): Promise<void> {
    return this.inTurn(async () => {
      const studentId = this.tokens.get(msg.token);
      const result = studentId ? onResume(this.seat(studentId).attempt, msg, this.now()) : undefined;
      if (studentId && result) await this.apply(studentId, result);
      if (studentId && result?.reply?.type === 'joined') return this.welcome(studentId, link);
      link.send({ v: PROTOCOL_VERSION, type: 'refused', reason: result?.reply?.type === 'refused' ? result.reply.reason : 'notJoined' });
      link.close();
    });
  }

  /** Everything else a joined student's ExamMode says. From a connection that hasn't joined, it is ignored. */
  receive(link: Link, msg: FromStudent): Promise<void> {
    if (msg.type === 'join') return this.join(msg, link);
    if (msg.type === 'resume') return this.resume(msg, link);
    return this.inTurn(async () => {
      const studentId = this.links.get(link);
      if (!studentId) return;
      const seat = this.seat(studentId);
      const at = this.now();
      switch (msg.type) {
        case 'checks': return this.apply(studentId, onChecks(seat.attempt, msg.results, at));
        case 'beat': return this.apply(studentId, onBeat(seat.attempt, msg, at));
        case 'event': return this.apply(studentId, onEvent(seat.attempt, msg, at));
        case 'leave': return this.apply(studentId, onLeave(seat.attempt, at));
        case 'ready': {
          await this.apply(studentId, onReady(seat.attempt, at, { started: this.run.startedAt !== null }));
          // a late joiner is in the exam at once, with the time that is left (F-08)
          if (seat.attempt.state === 'inExam') this.tell(seat, 'start');
        }
      }
    });
  }

  /** The connection closed. Nothing is decided by that: the beats decide (§2.8). */
  dropped(link: Link): void {
    const studentId = this.links.get(link);
    if (studentId) {
      this.links.delete(link);
      this.seat(studentId).link = undefined;
      this.changed(studentId);
    }
    for (const seat of this.seats.values()) if (seat.waiting === link) seat.waiting = undefined;
  }

  /** The Guard saw ExamMode's process end without unlocking (F-20). False: no attempt has this token. */
  stopped(msg: Stopped): Promise<boolean> {
    return this.inTurn(async () => {
      const studentId = this.tokens.get(msg.token);
      if (!studentId) return false;
      await this.apply(studentId, onStopped(this.seat(studentId).attempt, msg, this.now()));
      return true;
    });
  }

  // ── files ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Where a file to give is, for a student of this run who is in it (or about to be); nothing otherwise. */
  givenFile(token: string, name: string): string | undefined {
    const studentId = this.tokens.get(token);
    const folder = this.options.given?.(this.exam.id);
    if (!studentId || !folder || !this.given.some((f) => f.name === name)) return undefined;
    const { state } = this.seat(studentId).attempt;
    return ['checking', 'ready', 'inExam', 'noContact'].includes(state) ? join(folder, name) : undefined;
  }

  /** Is this the token of one of this run's attempts? */
  knows(token: string): boolean {
    return this.tokens.has(token);
  }

  /** Before any file is taken: is this an attempt that may send files now? */
  mayUpload(meta: Upload): 'ok' | 'unknown' | 'refused' {
    const studentId = this.tokens.get(meta.token);
    if (!studentId) return 'unknown';
    const { state } = this.seat(studentId).attempt;
    if (state === 'inExam' || state === 'noContact') return 'ok';
    // the receipt was lost on the way: the hand-in may be sent again
    return state === 'handedIn' && meta.kind === 'handIn' ? 'ok' : 'refused';
  }

  /** A backup (F-22) or a hand-in (F-16): every file is checked against what was announced, then put in the
   *  student's folder. A hand-in is answered with its receipt. */
  async upload(meta: Upload, received: Received[]): Promise<UploadResult> {
    const result = await this.taken(meta, received);
    // the receipt is given only once the hand-in can't be lost, even if the power goes
    if (result.ok && result.receipt) await this.flushed();
    return result;
  }

  private taken(meta: Upload, received: Received[]): Promise<UploadResult> {
    return this.inTurn(async () => {
      const may = this.mayUpload(meta);
      if (may !== 'ok') return { ok: false, why: may };
      const studentId = this.tokens.get(meta.token)!;
      const seat = this.seat(studentId);
      const arrived = new Map(received.map((f) => [f.name, f]));
      const asAnnounced = meta.files.every((f) => isSafeName(f.name) && arrived.get(f.name)?.sha256 === f.sha256 && arrived.get(f.name)?.bytes === f.bytes);
      if (!asAnnounced || new Set(meta.files.map((f) => f.name)).size !== meta.files.length) return { ok: false, why: 'mismatch' };

      const receipt = meta.kind === 'handIn' ? await receiptCode(this.run.id, studentId, meta.files) : undefined;
      if (seat.attempt.state === 'handedIn') {
        return receipt === seat.receipt ? { ok: true, receipt: this.receipt(seat.receipt!, meta) } : { ok: false, why: 'refused' };
      }

      const at = this.now();
      const folder = this.folderOf(studentId);
      const id = seat.id ?? (await this.save(studentId));
      for (const f of meta.files) await place(arrived.get(f.name)!, folder, f.name);
      if (!receipt) {
        await this.store.saveFiles(id, meta.files, 'backup', at);
        seat.files = (await this.store.files(id)).length;
        this.changed(studentId);
        return { ok: true };
      }
      // backups of files that aren't in the hand-in (deleted since, or put back as they were given) are kept apart
      const handedIn = new Set(meta.files.map((f) => f.name));
      for (const old of await this.store.files(id)) if (!handedIn.has(old.name)) await setAside(folder, old.name, EARLIER);
      const how = this.handInHow(seat.attempt, at, seat.toldEnd);
      await this.store.saveFiles(id, meta.files, how, at);
      seat.files = meta.files.length;
      seat.receipt = receipt;
      await this.apply(studentId, onHandIn(seat.attempt, how, at));
      return { ok: true, receipt: this.receipt(receipt, meta) };
    });
  }

  // ── from the teacher ──────────────────────────────────────────────────────────────────────────────────────────

  /** Start: the exam begins on every ready computer at once (F-08). */
  start(): Promise<void> {
    return this.inTurn(async () => {
      if (this.run.startedAt !== null || this.run.endedAt !== null) return;
      const at = this.now();
      await this.changeRun({ startedAt: at }, 'runStarted');
      for (const [studentId, seat] of this.seats) {
        await this.apply(studentId, onStart(seat.attempt, at));
        if (seat.attempt.state === 'inExam') this.tell(seat, 'start');
      }
    });
  }

  /** Add time for everyone, or for one student (F-41). */
  addTime(minutes: number, studentId?: string): Promise<void> {
    return this.inTurn(async () => {
      const at = this.now();
      if (studentId === undefined) await this.changeRun({ extraMinutes: this.run.extraMinutes + minutes }, 'timeAdded', { minutes });
      else await this.apply(studentId, addTime(this.seat(studentId).attempt, minutes, at));
      for (const [id, seat] of this.seats) {
        if (studentId !== undefined && id !== studentId) continue;
        const end = this.endsAt(seat.attempt);
        if (end === undefined || seat.attempt.state !== 'inExam') continue;
        if (end > at) seat.toldEnd = false;
        this.tell(seat, 'time');
      }
    });
  }

  /** End the exam: every student still in it is told to hand in (F-41). Nobody can join any more. */
  end(): Promise<void> {
    return this.inTurn(async () => {
      if (this.run.endedAt !== null) return;
      await this.changeRun({ endedAt: this.now() }, 'runEnded');
      for (const seat of this.seats.values()) {
        if (seat.attempt.state === 'inExam') this.tellEnd(seat);
        seat.waiting?.send({ v: PROTOCOL_VERSION, type: 'refused', reason: 'ended' });
        seat.waiting?.close();
        seat.waiting = undefined;
      }
    });
  }

  /** Let back in (F-40): the join that waits is accepted; with none waiting, the student's next one will be. */
  letBackIn(studentId: string, reason: string): Promise<void> {
    return this.inTurn(async () => {
      const seat = this.seat(studentId);
      const result = onLetBackIn(seat.attempt, { reason }, this.now());
      if (result.reply?.type === 'joined') this.giveToken(studentId);
      await this.apply(studentId, result);
      const waiting = seat.waiting;
      seat.waiting = undefined;
      if (result.reply?.type === 'joined' && waiting) this.welcome(studentId, waiting);
    });
  }

  /** Keep out (F-40): the join that waits is refused. */
  keepOut(studentId: string, reason: string): Promise<void> {
    return this.inTurn(async () => {
      const seat = this.seat(studentId);
      await this.apply(studentId, onKeepOut(seat.attempt, { reason }, this.now()));
      seat.waiting?.send({ v: PROTOCOL_VERSION, type: 'refused', reason: 'keptOut' });
      seat.waiting?.close();
      seat.waiting = undefined;
    });
  }

  /** The teacher's clock ticks: who hasn't been heard from (§2.8), and whose time is up (F-17)? */
  tick(): Promise<void> {
    return this.inTurn(async () => {
      const at = this.now();
      for (const [studentId, seat] of this.seats) {
        await this.apply(studentId, onTick(seat.attempt, at));
        const end = this.endsAt(seat.attempt);
        if (seat.attempt.state === 'inExam' && !seat.toldEnd && end !== undefined && at >= end) this.tellEnd(seat);
      }
    });
  }

  // ── inside ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** One thing at a time, in the order it arrived: what is in the store is what happened. */
  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const done = this.queue.then(() => this.store.together(work));
    this.queue = done.catch(() => undefined);
    return done;
  }

  /** What was written is on the disk for good when this is done (N-05). Asked for many times at once — 40 hand-ins
   *  at time up — it is one visit to the disk for all of them. */
  private flushed(): Promise<void> {
    this.flushing ??= new Promise((resolve) => {
      setTimeout(() => {
        this.queue = this.queue.then(() => {
          this.flushing = undefined;
          try {
            this.store.flush();
          } catch {
            // the store was closed meanwhile: closing it wrote everything
          }
          resolve();
        });
      }, FLUSH_MS);
    });
    return this.flushing;
  }

  private seat(studentId: string): Seat {
    const seat = this.seats.get(studentId);
    if (!seat) throw new Error(`No student ${studentId} in this run's class`);
    return seat;
  }

  private endsAt(attempt?: Attempt): number | undefined {
    return endsAt({ startedAt: this.run.startedAt ?? undefined, minutes: this.exam.minutes, extraMinutes: this.run.extraMinutes }, attempt);
  }

  private handInHow(a: Attempt, at: number, toldEnd = false): HandInHow {
    if (this.run.endedAt !== null) return 'ended';
    const end = this.endsAt(a);
    return toldEnd || end !== undefined && at >= end - TIME_UP_SLACK_MS ? 'timeUp' : 'handIn';
  }

  private receipt(code: string, meta: Upload): Receipt {
    return { v: PROTOCOL_VERSION, type: 'receipt', code, files: meta.files };
  }

  /** Five wrong codes from one computer, and it waits a minute: the code can't be found by trying them all. */
  private codeRight(code: string, from = ''): boolean {
    const at = this.now();
    const wrong = this.wrongCodes.get(from) ?? { count: 0, until: 0 };
    if (at < wrong.until) return false;
    if (code === this.run.code) {
      this.wrongCodes.delete(from);
      return true;
    }
    const count = wrong.count + 1;
    this.wrongCodes.set(from, count >= WRONG_CODES ? { count: 0, until: at + WRONG_CODE_WAIT_MS } : { count, until: 0 });
    return false;
  }

  private giveToken(studentId: string): void {
    const seat = this.seat(studentId);
    if (seat.token) this.tokens.delete(seat.token);
    seat.token = newToken();
    seat.toldEnd = false;
    this.tokens.set(seat.token, studentId);
  }

  /** This connection is the student's now; an older one is closed. Then: you are in. */
  private welcome(studentId: string, link: Link): void {
    const seat = this.seat(studentId);
    if (seat.link && seat.link !== link) {
      this.links.delete(seat.link);
      seat.link.close();
    }
    seat.link = link;
    this.links.set(link, studentId);
    const state = seat.attempt.state as 'checking' | 'ready' | 'inExam';
    const { title, teacher, minutes, websites } = this.exam;
    link.send({
      v: PROTOCOL_VERSION, type: 'joined', token: seat.token!, now: this.now(), state, endsAt: state === 'inExam' ? this.endsAt(seat.attempt) : undefined,
      exam: { title, teacher, class: this.className, minutes, websites, files: this.given },
    });
    this.changed(studentId);
  }

  private tell(seat: Seat, type: 'start' | 'time'): void {
    const end = this.endsAt(seat.attempt);
    if (end !== undefined) seat.link?.send({ v: PROTOCOL_VERSION, type, endsAt: end });
  }

  private tellEnd(seat: Seat): void {
    seat.toldEnd = true;
    seat.link?.send({ v: PROTOCOL_VERSION, type: 'end' });
  }

  private async save(studentId: string): Promise<number> {
    const seat = this.seat(studentId);
    seat.id = await this.store.saveAttempt(this.run.id, studentId, seat.attempt, { token: seat.token, receipt: seat.receipt });
    return seat.id;
  }

  /** Takes what the rules decided: the attempt, to the store if it changed; the events, to the log. */
  private async apply(studentId: string, result: Result): Promise<void> {
    const seat = this.seat(studentId);
    const before = seat.attempt;
    seat.attempt = result.attempt;
    const out = result.attempt.state === 'notJoined' || result.attempt.state === 'left';
    if (result.attempt.state === 'notJoined' && seat.token) {
      this.tokens.delete(seat.token);
      seat.token = undefined;
    }
    if (out && before.state !== result.attempt.state && seat.link) {
      this.links.delete(seat.link);
      seat.link.close();
      seat.link = undefined;
    }
    if (kept(before) !== kept(result.attempt) || seat.id === undefined && result.events.length > 0) await this.save(studentId);
    const pc = result.attempt.pc ?? before.pc;
    await this.store.log(this.run.id, result.events.map((e) => ({ studentId, pc: typeof e.details.pc === 'string' ? e.details.pc : pc, at: e.at, kind: e.kind, details: e.details })));
    if (shown(before) !== shown(result.attempt) || result.events.length > 0) this.changed(studentId);
  }

  private async changeRun(change: Partial<Pick<RunRow, 'startedAt' | 'extraMinutes' | 'endedAt'>>, kind: string, details: Record<string, unknown> = {}): Promise<void> {
    this.run = { ...this.run, ...change };
    void this.flushed();
    await this.store.updateRun(this.run.id, change);
    await this.store.log(this.run.id, [{ at: this.now(), kind, details }]);
    this.changed();
  }

  private changed(studentId?: string): void {
    for (const listener of this.listeners) listener(studentId);
  }
}
