/**
 * The teacher's side of ExamMode without its windows: the store, the server, the beacon and the run that is open,
 * and the one state the teacher's screens show (architecture §2.2). M3: open an exam (11, minimal), the lobby (12),
 * the live view (13).
 */
import { parseSite, type Website } from '@lib/browser/sites';
import type { ExamForm, FeedItem, KeptFile, TeacherState } from '@lib/app/state';
import { logCsv } from '@lib/exam/log';
import { BeaconSender, type BeaconOptions } from './beacon';
import { Classroom } from './classroom';
import { ClassroomServer } from './server';
import { Store } from './store/store';

export interface DeskOptions {
  /** the database file */
  db: string;
  /** the Hand-ins folder */
  handIns: string;
  port?: number;
  beacon?: BeaconOptions;
  now?: () => number;
  /** how often the run's clock ticks */
  tickMs?: number;
  /** opens a website once and answers with the other hosts it loads its files from (§2.6) */
  record?: (start: string) => Promise<string[]>;
}

/** Not worth a line in *What's happening*: the lobby's list and the cards show them. */
const QUIET = ['runOpened', 'joined', 'ready', 'started'];
const FEED = 100;
const MAX_MINUTES = 600;

export class TeacherDesk {
  private room?: Classroom;
  private unwatch?: () => void;
  private current: TeacherState = { screen: 'make', classes: [], defaults: { teacher: '' }, students: [], feed: [], events: [], files: {} };
  private readonly listeners = new Set<(state: TeacherState) => void>();
  private refreshing?: Promise<void>;
  private again = false;
  private closed = false;

  private constructor(private readonly store: Store, private readonly server: ClassroomServer, private readonly beacon: BeaconSender, private readonly options: DeskOptions) {}

  static async open(options: DeskOptions): Promise<TeacherDesk> {
    const store = new Store(options.db);
    const server = new ClassroomServer({ handIns: options.handIns, port: options.port, tickMs: options.tickMs });
    try {
      await server.listen();
    } catch (error) {
      store.close();
      throw error;
    }
    const beacon = new BeaconSender(() => server.listings(), options.beacon);
    await beacon.start();
    const desk = new TeacherDesk(store, server, beacon, options);
    // a run that was open when the laptop restarted is open again (N-05)
    const open = (await store.runsNotEnded()).at(-1);
    if (open) desk.watch(await Classroom.open(store, open.id, { handIns: options.handIns, now: options.now }));
    await desk.refresh();
    return desk;
  }

  get port(): number {
    return this.server.port;
  }

  /** The open run's folder in Hand-ins. */
  get folder(): string | undefined {
    return this.room?.view().run.folder;
  }

  state(): TeacherState {
    return this.current;
  }

  onState(listener: (state: TeacherState) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Opens an exam for students. Answers with what is wrong with the form, in words, if anything is. */
  async openExam(form: ExamForm): Promise<string | undefined> {
    if (this.room) return 'An exam is already open.';
    const title = form.title.trim();
    const teacher = form.teacher.trim();
    if (teacher === '') return 'Type your name: students see who set the exam.';
    if (title === '') return 'Give the exam a title.';
    if (!Number.isInteger(form.minutes) || form.minutes < 1 || form.minutes > MAX_MINUTES) return `The time is between 1 minute and ${MAX_MINUTES / 60} hours.`;
    const typed = form.websites.map((w) => w.trim()).filter((w) => w !== '');
    const unreadable = typed.find((w) => !parseSite(w));
    if (unreadable) return `"${unreadable}" isn't a website address. Type it like docs.python.org/* or school.example/exam-page.`;

    let classId = form.classId;
    if (!classId) {
      const names = [...new Set(form.studentNames.split('\n').map((n) => n.trim()).filter((n) => n !== ''))];
      if (form.className.trim() === '') return 'Name the class.';
      if (names.length === 0) return 'Type the students\' names, one on each line.';
      classId = (await this.store.addClass(form.className.trim(), names.map((name) => ({ name })))).id;
    }
    const websites: Website[] = [];
    for (const url of typed) websites.push({ url, hosts: await (this.options.record?.(parseSite(url)!.start).catch(() => []) ?? []) });
    const now = (this.options.now ?? Date.now)();
    const exam = await this.store.addExam({ title, teacher, classId, minutes: form.minutes, websites }, now);
    this.watch(await Classroom.create(this.store, exam.id, { handIns: this.options.handIns, now: this.options.now }));
    this.beacon.announce();
    await this.refresh();
    return undefined;
  }

  async start(): Promise<void> {
    await this.room?.start();
  }

  async end(): Promise<void> {
    await this.room?.end();
  }

  /** Let back in (F-40): the reason goes in the log. */
  async letBackIn(studentId: string, reason: string): Promise<void> {
    await this.room?.letBackIn(studentId, reason.trim());
  }

  async keepOut(studentId: string, reason: string): Promise<void> {
    await this.room?.keepOut(studentId, reason.trim());
  }

  /** More time, for one student or for everyone (F-41). */
  async addTime(minutes: number, studentId?: string): Promise<void> {
    if (Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_MINUTES) await this.room?.addTime(minutes, studentId);
  }

  /** A student's folder in the open run's hand-ins. */
  folderOf(studentId: string): string | undefined {
    return this.room?.folderOf(studentId);
  }

  /** The open run's log as a spreadsheet (F-42). */
  logCsv(): string {
    return logCsv(this.current.events);
  }

  /** After the end: the run is put away, and another exam can be opened. */
  async done(): Promise<void> {
    if (!this.room || this.room.view().run.endedAt === undefined) return;
    this.unwatch?.();
    this.server.remove(this.room.id);
    this.room = undefined;
    await this.refresh();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unwatch?.();
    await this.beacon.stop();
    await this.server.close();
    await this.refreshing;
    this.store.close();
  }

  private watch(room: Classroom): void {
    this.room = room;
    this.server.add(room);
    this.unwatch = room.onChange(() => void this.refresh());
  }

  /** Builds the state again and tells the screens. Changes that come while it is being built are one more turn. */
  private refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.again = false;
        this.current = await this.build();
        for (const listener of this.listeners) listener(this.current);
      } while (this.again);
    })().finally(() => void (this.refreshing = undefined));
    return this.refreshing;
  }

  private async build(): Promise<TeacherState> {
    const classes = await this.store.classes();
    const last = await this.store.lastExam();
    const defaults = { teacher: last?.teacher ?? '', classId: last?.classId };
    if (!this.room) return { screen: 'make', classes, defaults, students: [], feed: [], events: [], files: {} };
    const { run, students } = this.room.view();
    const names = new Map(students.map((s) => [s.id, s.name]));
    const events: FeedItem[] = (await this.store.events(run.id))
      .map((e) => ({ id: e.id, at: e.at, kind: e.kind, studentId: e.studentId ?? undefined, student: e.studentId ? names.get(e.studentId) : undefined, pc: e.pc ?? undefined, details: e.details }));
    const feed = events.filter((e) => !QUIET.includes(e.kind)).slice(-FEED).reverse();
    const files: Record<string, KeptFile[]> = {};
    for (const [studentId, kept] of await this.store.runFiles(run.id)) files[studentId] = kept.map(({ name, bytes, kind }) => ({ name, bytes, kind }));
    const screen = run.endedAt !== undefined ? 'ended' : run.startedAt === undefined ? 'lobby' : 'live';
    return { screen, classes, defaults, run, students, feed, events, files };
  }
}
