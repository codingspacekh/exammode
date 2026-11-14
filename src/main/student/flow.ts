/**
 * The student's side of ExamMode without its windows: finding exams, joining, the exam, the hand-in — and the one
 * state the student's screens show (architecture §2.2). M3: 01 Join, 03 Waiting, 04 the exam bar, 09 Hand in,
 * 09b Handed in. The computer isn't checked or locked yet (M4), so joining goes straight to waiting.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { folderName } from '@lib/files/names';
import type { FoundExam, JoinError, Name, StudentState } from '@lib/app/state';
import { examProfiles } from '@lib/profiles/exam-apps';
import type { ExamInfo } from '@lib/protocol/messages';
import { Discovery, examsAt, namesOf, type Found } from './discovery';
import { StudentExam, type Receipt } from './exam';
import type { Lockdown } from './lockdown';
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
  /** a file that remembers the exam this computer is in, for coming back after ExamMode stopped (F-20) */
  remember?: string;
  /** locks this computer for an exam; none: exams run unlocked (a Mac, a development build) */
  lockdown?: Lockdown;
  /** for tests: faster beats and retries */
  timing?: Pick<SessionOptions, 'beatMs' | 'retryMs' | 'clockMs'> & { backupMs?: number; graceMs?: number };
}

interface Remembered { exam: FoundExam; student: Name; code: string }

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
  /** the computer is being locked again after Let back in */
  private relocking = false;
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

  /** ExamMode was started again by the Guard after it stopped suddenly (`--resume <run>`, F-20): it asks to join
   *  the exam it was in, as the same student — which is refused, and says so (10). Nothing happens if this
   *  computer doesn't remember that exam. */
  async resume(runId: string): Promise<void> {
    const file = this.options.remember;
    const was = file ? await readFile(file, 'utf8').then((text) => JSON.parse(text) as Remembered, () => undefined) : undefined;
    if (!was || was.exam.runId !== runId || this.current.screen !== 'join') return;
    this.typed = [was.exam];
    this.listed();
    this.set({ picked: runId, names: [was.student] });
    await this.join(was.student.id, was.code);
  }

  /** What `resume` needs, kept while this computer is in an exam. */
  private async remember(exam: FoundExam, student: Name, code: string): Promise<void> {
    const file = this.options.remember;
    if (!file) return;
    await mkdir(dirname(file), { recursive: true }).catch(() => undefined);
    await writeFile(file, JSON.stringify({ exam, student, code } satisfies Remembered)).catch(() => undefined);
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
    if (reply === 'joined') await this.remember(exam, student, code);
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

  /** 02: looks at the computer again — a second screen was unplugged, an app was closed. The teacher's list
   *  follows. */
  async checkAgain(): Promise<void> {
    const { session } = this;
    const lockdown = this.options.lockdown;
    if (!session || !lockdown || this.current.screen !== 'checks' || this.current.checks?.locking) return;
    const checked = await lockdown.check();
    if (session !== this.session || this.current.screen !== 'checks') return;
    session.checks(checked.checks.map(({ check, ok }) => ({ check, ok })));
    this.set({ checks: { ...checked, locking: false } });
  }

  /** 02: *Close the apps and continue* — the computer is locked, and the teacher's list says ready (F-05–F-07). */
  async lock(): Promise<void> {
    const { session } = this;
    const checks = this.current.checks;
    if (!session || this.current.screen !== 'checks' || !checks?.ok || checks.locking) return;
    this.set({ checks: { ...checks, locking: true, error: undefined } });
    const wrong = await this.lockNow(session);
    if (session !== this.session) return;
    if (wrong) return this.set({ checks: { ...checks, locking: false, error: wrong } });
    session.ready();
    this.set({ checks: undefined });
    this.sessionIs(session);
  }

  /** 02: Back — before Start that only takes the student off the teacher's list. */
  backOut(): void {
    if (this.current.screen !== 'checks' || this.current.checks?.locking) return;
    this.session?.leave();
    this.leaveSession();
    this.current = { ...this.fresh(), found: this.current.found, picked: this.current.picked, names: this.current.names };
    this.tell();
  }

  private async lockNow(session: Session): Promise<string | undefined> {
    const lockdown = this.options.lockdown;
    const found = this.found;
    const folder = this.exam?.files.folder;
    if (!lockdown || !found || !session.token || !folder) return 'This computer can\'t be locked.';
    const apps = examProfiles(session.exam?.apps ?? []);
    this.set({ apps: apps.map((a) => ({ id: a.id, name: a.name, badge: a.badge, running: false, front: false })) });
    const wrong = await lockdown.lock({
      runId: found.runId, teacher: { host: found.host, port: found.port }, websites: (session.exam?.websites.length ?? 0) > 0,
      token: session.token, instanceId: session.seat.instanceId, pc: this.options.pc, apps, examFolder: folder,
    }, {
      // 07: said to the student, and to the teacher at once
      closed: (app) => {
        if (session !== this.session) return;
        session.report('appClosed', { app: app.name });
        this.set({ closed: { name: app.name, at: this.now() } });
      },
      // the dots on the exam bar; and the teacher's card says which app is in front, with its window's title
      apps: (open) => {
        if (session !== this.session) return;
        const front = open.find((o) => o.front);
        const name = apps.find((a) => a.id === front?.id)?.name;
        session.front = name ? [name, front?.title].filter(Boolean).join(' · ') : undefined;
        this.set({ apps: this.current.apps.map((a) => ({ ...a, running: open.some((o) => o.id === a.id), front: front?.id === a.id })) });
      },
    }).catch((error: unknown) => String(error));
    if (!wrong && session === this.session) this.set({ locked: true });
    // (the exam was left while the computer was being locked: put it back)
    if (!wrong && session !== this.session) void lockdown.unlock().catch(() => undefined);
    return wrong;
  }

  /** One of the exam's apps is pressed on the exam bar: it opens in the Exam folder, under the bar — or comes to
   *  the front if it is open (F-11). One that isn't on this computer says so, and the teacher's log gets a note. */
  async openApp(id: string): Promise<void> {
    const { session, exam } = this;
    const lockdown = this.options.lockdown;
    const app = this.current.apps.find((a) => a.id === id);
    if (!session || !exam || !lockdown || !app || this.current.screen !== 'exam') return;
    await exam.begin();
    const wrong = await lockdown.openApp(id).catch(() => 'failed' as const);
    if (!wrong || session !== this.session) return;
    session.report('appMissing', { app: app.name, why: wrong });
    this.set({ appMissing: { name: app.name, at: this.now() } });
  }

  /** Something for the teacher's log (a blocked page …). */
  report(kind: string, details: Record<string, unknown>): void {
    this.session?.report(kind, details);
  }

  /** Hand in…: the files that will go (09). */
  async askHandIn(): Promise<void> {
    if (this.current.screen !== 'exam' || !this.exam) return;
    const handIn = await this.exam.files.view().catch(() => ({ files: [], unchanged: [] }));
    if (this.current.screen === 'exam') this.set({ screen: 'handIn', handIn });
  }

  /** Back to the exam from Hand in (09) or Leave (08). */
  keepWorking(): void {
    const asking = this.current.screen === 'handIn' || this.current.screen === 'leave';
    if (asking && !this.current.handingIn) this.set({ screen: 'exam', handIn: undefined });
  }

  /** ⋯ Leave the exam: what would be handed in as it is (08). */
  async askLeave(): Promise<void> {
    if (this.current.screen !== 'exam' || !this.exam) return;
    const handIn = await this.exam.files.view().catch(() => ({ files: [], unchanged: [] }));
    if (this.current.screen === 'exam') this.set({ screen: 'leave', handIn });
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
    this.forget();
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
    this.forget();
    this.leaveSession();
    this.current = { ...this.fresh(), found: this.current.found };
    this.tell();
  }

  async stop(): Promise<void> {
    this.leaveSession();
    await this.discovery?.stop();
  }

  // ── inside ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The exam is over for this computer: there is nothing to come back to. */
  private forget(): void {
    if (this.options.remember) void rm(this.options.remember, { force: true }).catch(() => undefined);
  }

  private fresh(): StudentState {
    return { screen: 'join', pc: this.options.pc, found: [], names: [], joining: false, clockOffset: 0, contact: true, handingIn: false, locked: false, apps: [] };
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
      case 'checking': {
        // (also when the teacher's laptop took this student back as a new arrival after a long gap in the lobby)
        const lockdown = this.options.lockdown;
        if (!lockdown) {
          // nothing to lock this computer with: the exam runs unlocked
          session.checks([]);
          session.ready();
          return this.set({ screen: 'waiting', contact: true, lostAt: undefined });
        }
        // locked already (the gap in the lobby): ready again, without asking twice
        if (this.current.locked) {
          session.ready();
          return this.set({ screen: 'waiting', contact: true, lostAt: undefined });
        }
        if (this.current.screen === 'checks') return this.set({ contact: true, lostAt: undefined });
        this.set({ screen: 'checks', contact: true, lostAt: undefined, checks: { checks: [], ok: false, toClose: [], locking: false } });
        return void this.checkAgain();
      }
      case 'ready': return this.set({ screen: 'waiting', contact: true, lostAt: undefined });
      // also after Let back in: the exam opens here by itself (F-18) — and the computer locks again first
      case 'inExam':
        if (this.options.lockdown && !this.current.locked && !this.relocking) {
          this.relocking = true;
          void this.lockNow(session).then((wrong) => {
            this.relocking = false;
            if (wrong && session === this.session) session.report('ruleChanged', { what: 'This computer couldn\'t be locked again', why: wrong });
          });
        }
        return this.set({ screen: during ? this.current.screen : 'exam', contact: true, lostAt: undefined, left: undefined, exam: this.examOf(session.exam) });
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
    // the exam is over on this computer, however it ended: it goes back to how it was (F-21)
    if (this.current.locked) void this.options.lockdown?.unlock().catch(() => undefined);
    this.current = { ...this.current, locked: false, closed: undefined, apps: [], appMissing: undefined };
  }
}
