/**
 * The student's side of ExamMode without its windows: finding exams, joining, the exam, the hand-in — and the one
 * state the student's screens show (architecture §2.2). M3: 01 Join, 03 Waiting, 04 the exam bar, 09 Hand in,
 * 09b Handed in. The computer isn't checked or locked yet (M4), so joining goes straight to waiting.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { folderName } from '@lib/files/names';
import type { FoundExam, JoinError, StudentState } from '@lib/app/state';
import type { ExamInfo } from '@lib/protocol/messages';
import { Discovery, examsAt, namesOf, type Found } from './discovery';
import { StudentExam, type Receipt } from './exam';
import { listFiles } from './files';
import { Session, type SessionOptions } from './session';

export interface FlowOptions {
  /** this computer's name */
  pc: string;
  /** where Exam folders are made: one per run and student inside it */
  examRoot: string;
  /** new for every Windows boot */
  bootId: string;
  /** the port to listen on for teachers' announcements; false: don't listen */
  discoveryPort?: number | false;
  /** the teacher's port, for a computer name that was typed in */
  teacherPort?: number;
  now?: () => number;
  /** for tests: faster beats and retries */
  timing?: Pick<SessionOptions, 'beatMs' | 'retryMs' | 'clockMs'> & { backupMs?: number; graceMs?: number };
}

const toFound = (f: Found): FoundExam => ({ runId: f.runId, title: f.title, teacher: f.teacher, class: f.class, minutes: f.minutes, host: f.host, port: f.port });

export class StudentFlow {
  session?: Session;
  exam?: StudentExam;
  private current: StudentState;
  private readonly listeners = new Set<(state: StudentState) => void>();
  private readonly discovery?: Discovery;
  /** exams found by a typed-in computer name */
  private typed: FoundExam[] = [];
  /** the hand-in was started by the clock or by the teacher, not by the student */
  private byItself = false;
  /** the exam that was joined, as it was found */
  private found?: FoundExam;
  private readonly now: () => number;

  constructor(private readonly options: FlowOptions) {
    this.now = options.now ?? Date.now;
    this.current = this.fresh();
    if (options.discoveryPort !== false) this.discovery = new Discovery({ port: options.discoveryPort, now: this.now });
  }

  /** Starts listening for exams. A network that can't be listened on isn't the end: the name can be typed. */
  async start(): Promise<void> {
    this.discovery?.onChange(() => this.listed());
    await this.discovery?.start().catch(() => undefined);
    this.listed();
  }

  state(): StudentState {
    return this.current;
  }

  onState(listener: (state: StudentState) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** The port it listens on for teachers' announcements. */
  get discoveryPort(): number | undefined {
    return this.discovery?.port;
  }

  /** The websites of the exam that was joined; none: the questions are on paper. */
  get websites() {
    return this.session?.exam?.websites ?? [];
  }

  /** The Exam folder of the exam that was joined. */
  get folder(): string | undefined {
    return this.exam?.files.folder;
  }

  /** Chooses an exam on 01 and fetches its class list (F-02). */
  async pick(runId: string): Promise<void> {
    const exam = this.current.found.find((f) => f.runId === runId);
    if (!exam) return;
    this.set({ picked: runId, names: [], joinError: undefined });
    const names = await namesOf(exam).catch(() => []);
    if (this.current.picked === runId) this.set({ names });
  }

  /** The teacher's computer name, typed in because no exam was found (F-01, R3). */
  async lookAt(host: string): Promise<void> {
    this.typed = (await examsAt(host.trim(), this.options.teacherPort, this.now)).map(toFound);
    this.listed();
    if (this.typed.length === 0) this.set({ joinError: 'unreachable' });
  }

  async join(studentId: string, code: string): Promise<void> {
    const exam = this.current.found.find((f) => f.runId === this.current.picked);
    const student = this.current.names.find((n) => n.id === studentId);
    if (!exam || !student || this.current.joining) return;
    this.leaveSession();
    this.set({ joining: true, joinError: undefined });
    const session = new Session({
      host: exam.host, port: exam.port, runId: exam.runId, studentId, code, pc: this.options.pc, instanceId: randomUUID(), bootId: this.options.bootId,
      now: this.now, ...this.options.timing,
    });
    const folder = join(this.options.examRoot, folderName(`${exam.title} ${exam.runId.slice(0, 8)}`), folderName(student.name));
    const work = new StudentExam(session, { folder, backupMs: this.options.timing?.backupMs, retryMs: this.options.timing?.retryMs, graceMs: this.options.timing?.graceMs });
    this.session = session;
    this.exam = work;
    this.byItself = false;
    session.on((e) => {
      if (session !== this.session) return;
      if (e.type === 'end' || e.type === 'timeUp') this.byItself = true;
      if (e.type === 'endsAt') this.set({ endsAt: e.endsAt, clockOffset: session.clockOffset });
      if (e.type === 'state') this.sessionIs(session);
    });
    work.on((e) => {
      if (work === this.exam && e.type === 'handedIn') this.handedIn(e.receipt);
      // the teacher's laptop no longer takes this student's work (they left, on another ExamMode)
      if (work === this.exam && e.type === 'handInRefused') this.backToJoin('left');
    });

    this.found = exam;
    const reply = await session.join();
    if (session !== this.session) return;
    if (reply !== 'joined' && reply !== 'left') return this.backToJoin(reply);
    // `left`: refused, and the teacher was told; the join waits for Let back in or Keep out (10)
    this.set({ joining: false, student, contact: true, clockOffset: session.clockOffset, exam: this.examOf(session.exam) });
    this.sessionIs(session);
  }

  /** The exam as the screens show it: as the lab computer found it, then as the teacher's laptop described it. */
  private examOf(info?: ExamInfo): StudentState['exam'] {
    const found = this.found;
    if (!found) return undefined;
    return { runId: found.runId, title: info?.title ?? found.title, teacher: info?.teacher ?? found.teacher, minutes: info?.minutes ?? found.minutes ?? 0, hasQuestions: (info?.websites.length ?? 0) > 0 };
  }

  /** Something for the teacher's log (a blocked page …). */
  report(kind: string, details: Record<string, unknown>): void {
    this.session?.report(kind, details);
  }

  /** Hand in…: the files that will go (09). */
  async askHandIn(): Promise<void> {
    if (this.current.screen !== 'exam' || !this.exam) return;
    const files = await listFiles(this.exam.files.folder).catch(() => []);
    if (this.current.screen === 'exam') this.set({ screen: 'handIn', handIn: { files, unchanged: [] } });
  }

  /** Back to the exam from Hand in (09) or Leave (08). */
  keepWorking(): void {
    const asking = this.current.screen === 'handIn' || this.current.screen === 'leave';
    if (asking && !this.current.handingIn) this.set({ screen: 'exam', handIn: undefined });
  }

  /** ⋯ Leave the exam: what would be handed in as it is (08). */
  async askLeave(): Promise<void> {
    if (this.current.screen !== 'exam' || !this.exam) return;
    const files = await listFiles(this.exam.files.folder).catch(() => []);
    if (this.current.screen === 'exam') this.set({ screen: 'leave', handIn: { files, unchanged: [] } });
  }

  /** Leave, confirmed (F-15): the work so far goes to the teacher, and this computer is as it was. */
  async leave(): Promise<void> {
    const { exam } = this;
    if (this.current.screen !== 'leave' || !exam || this.current.handingIn) return;
    this.set({ handingIn: true });
    await exam.leave();
    if (exam !== this.exam) return;
    this.leaveSession();
    this.current = { ...this.fresh(), found: this.current.found };
    this.tell();
  }

  /** Close on *You can't join this exam again* (10): stop asking. */
  giveUp(): void {
    if (this.current.screen !== 'cantJoin') return;
    this.leaveSession();
    this.current = { ...this.fresh(), found: this.current.found };
    this.tell();
  }

  /** Hand in now. It keeps trying until the teacher's laptop has the work (F-19). */
  async handIn(): Promise<void> {
    if (this.current.screen !== 'handIn' || !this.exam) return;
    this.set({ handingIn: true });
    await this.exam.handIn();
  }

  /** Finish (09b): ExamMode is as it was before the exam. */
  finish(): void {
    if (this.current.screen !== 'handedIn') return;
    this.leaveSession();
    this.current = { ...this.fresh(), found: this.current.found };
    this.tell();
  }

  async stop(): Promise<void> {
    this.leaveSession();
    await this.discovery?.stop();
  }

  // ── inside ────────────────────────────────────────────────────────────────────────────────────────────────────

  private fresh(): StudentState {
    return { screen: 'join', pc: this.options.pc, found: [], names: [], joining: false, clockOffset: 0, contact: true, handingIn: false };
  }

  private set(change: Partial<StudentState>): void {
    this.current = { ...this.current, ...change };
    this.tell();
  }

  private tell(): void {
    for (const listener of this.listeners) listener(this.current);
  }

  /** What is open on the network, and what a typed-in name found. An exam that is gone is no longer chosen. */
  private listed(): void {
    const heard = (this.discovery?.found() ?? []).map(toFound);
    const found = [...heard, ...this.typed.filter((t) => !heard.some((h) => h.runId === t.runId))];
    const gone = this.current.screen === 'join' && this.current.picked !== undefined && !found.some((f) => f.runId === this.current.picked);
    this.set(gone ? { found, picked: undefined, names: [] } : { found });
  }

  /** The session's state, as a screen. */
  private sessionIs(session: Session): void {
    const during = ['handIn', 'leave', 'handedIn'].includes(this.current.screen);
    switch (session.state) {
      case 'checking':
        // M3: nothing is checked or locked yet (M4), so the computer is ready at once — also when the teacher's
        // laptop took this student back as a new arrival after a long gap in the lobby
        session.checks([]);
        session.ready();
        return this.set({ screen: 'waiting', contact: true, lostAt: undefined });
      case 'ready': return this.set({ screen: 'waiting', contact: true, lostAt: undefined });
      // also after Let back in: the exam opens here by itself (F-18)
      case 'inExam': return this.set({ screen: during ? this.current.screen : 'exam', contact: true, lostAt: undefined, left: undefined, exam: this.examOf(session.exam) });
      case 'noContact': return this.set({ contact: false, lostAt: this.current.lostAt ?? this.now() });
      case 'waiting': return this.set({ screen: 'cantJoin', left: session.left, contact: true });
      case 'refused': return this.backToJoin(session.reason ?? 'left');
      default:
    }
  }

  private handedIn(receipt: Receipt): void {
    this.set({
      screen: 'handedIn', handingIn: false, handIn: undefined, endsAt: undefined,
      receipt: { code: receipt.code, files: receipt.files.map(({ name, bytes }) => ({ name, bytes })), at: this.session?.teacherNow() ?? this.now(), byItself: this.byItself },
    });
  }

  private backToJoin(error: JoinError): void {
    this.leaveSession();
    this.current = { ...this.fresh(), found: this.current.found, picked: this.current.picked, names: this.current.names, joinError: error };
    this.tell();
  }

  private leaveSession(): void {
    const { session, exam } = this;
    this.session = undefined;
    this.exam = undefined;
    exam?.stop();
    session?.close();
  }
}
