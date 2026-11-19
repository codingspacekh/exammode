/**
 * The teacher's side of ExamMode without its windows: the store, the server, the beacon and the run that is open,
 * and the one state the teacher's screens show (architecture §2.2): the kept exams and classes, Make an exam (11),
 * the lobby (12), the live view (13) and what is kept after the end (14).
 */
import { QUIET } from '@domain/exam/events';
import type { Identity } from '@infrastructure/crypto/signed';
import { copyFile, cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseSite, type Website } from '@domain/browser/sites';
import { parseRoster } from '@domain/exam/roster';
import { isSafeName } from '@domain/files/names';
import { isProgramPath } from '@domain/profiles/exam-apps';
import type { FileMeta } from '@contracts/network/messages';
import type { ExamForm, FeedItem, KeptFile, TeacherState } from '@contracts/ipc/state';
import { logCsv } from '@domain/exam/log';
import { BeaconSender, type BeaconOptions } from '@infrastructure/network/beacon';
import { hashFile } from '@infrastructure/fs/files';
import { Classroom, type ClassroomOptions } from './classroom';
import { labApps } from '@domain/profiles/inventory';
import { ClassroomServer } from '@infrastructure/network/server';
import { Store } from '@infrastructure/persistence/store';

export interface DeskOptions {
  /** the database file */
  db: string;
  /** the Hand-ins folder */
  handIns: string;
  /** where exams' files to give are kept; by default `exam-files` beside the database */
  given?: string;
  port?: number;
  beacon?: BeaconOptions;
  now?: () => number;
  /** how often the run's clock ticks */
  tickMs?: number;
  /** the teacher's licence and key (F-44); none: a development build's teacher */
  identity?: Identity;
  /** what went wrong, for the log file */
  log?: (where: string, what: string, error?: unknown) => void;
  /** the shortest time between two turns of bringing the screens up to date */
  refreshMs?: number;
  /** opens a website once and answers with the other hosts it loads its files from (§2.6) */
  record?: (start: string) => Promise<string[]>;
}

const FEED = 100;
/** How many of a run's events the screens are given: more than a day's exam has, short of a flood. */
const EVENTS_SHOWN = 3000;
/** The shortest time between two turns of bringing the screens up to date, while changes keep coming. */
const REFRESH_MS = 250;
const MAX_MINUTES = 600;
const MAX_TITLE = 100;
const MAX_NAME = 60;

export class TeacherDesk {
  private room?: Classroom;
  private unwatch?: () => void;
  private current: TeacherState = { screen: 'make', classes: [], exams: [], labApps: { computers: 0, profiles: {}, others: [] }, defaults: { teacher: '' }, students: [], feed: [], events: [], files: {} };
  private readonly listeners = new Set<(state: TeacherState) => void>();
  private refreshing?: Promise<void>;
  private again = false;
  private builtAt = 0;
  private library?: Pick<TeacherState, 'classes' | 'exams' | 'labApps' | 'defaults'>;
  private seen?: { runId: string; lastId: number; items: FeedItem[] };
  private kept?: { runId: string; mark: string; files: Record<string, KeptFile[]> };
  private closed = false;

  private constructor(private readonly store: Store, private readonly server: ClassroomServer, private readonly beacon: BeaconSender, private readonly options: DeskOptions) {}

  static async open(options: DeskOptions): Promise<TeacherDesk> {
    const store = new Store(options.db);
    // (the desk isn't made yet when the server is: what a lab computer says goes to it once it is)
    const made: { desk?: TeacherDesk } = {};
    const server = new ClassroomServer({
      handIns: options.handIns, port: options.port, tickMs: options.tickMs, identity: options.identity, log: options.log,
      inventory: async (report) => {
        const kept = await store.saveInventory(report.pc, { profiles: report.profiles, apps: report.apps }, Date.now());
        if (kept) void made.desk?.refresh();
        return kept;
      },
    });
    try {
      await server.listen();
    } catch (error) {
      store.close();
      throw error;
    }
    const beacon = new BeaconSender(() => server.listings(), options.beacon);
    await beacon.start();
    const desk = new TeacherDesk(store, server, beacon, options);
    made.desk = desk;
    // a run that was open when the laptop restarted is open again (N-05)
    const open = (await store.runsNotEnded()).at(-1);
    if (open) desk.watch(await Classroom.open(store, open.id, desk.roomOptions()));
    await desk.refresh();
    return desk;
  }

  /** Where an exam's files to give are kept: beside the database. */
  private givenFolder(examId: string): string {
    return join(this.options.given ?? join(dirname(this.options.db), 'exam-files'), examId);
  }

  private roomOptions(): ClassroomOptions {
    return { handIns: this.options.handIns, now: this.options.now, given: (examId) => this.givenFolder(examId) };
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

  /** Saves the form as an exam: a new one, or the one it changes (F-35). Answers with the exam, or with what is
   *  wrong with the form, in words. */
  async saveExam(form: ExamForm): Promise<{ id: string } | { error: string }> {
    const title = form.title.trim();
    const teacher = form.teacher.trim();
    if (teacher === '') return { error: 'Type your name: students see who set the exam.' };
    if (title === '') return { error: 'Give the exam a title.' };
    // (the title, the teacher's and the class's name go out in the announcement, which has to fit in one packet
    // — in Khmer a letter is three bytes)
    if (title.length > MAX_TITLE) return { error: `The title is too long: ${MAX_TITLE} letters at most.` };
    if (teacher.length > MAX_NAME) return { error: `Your name is too long: ${MAX_NAME} letters at most.` };
    if (!Number.isInteger(form.minutes) || form.minutes < 1 || form.minutes > MAX_MINUTES) return { error: `The time is between 1 minute and ${MAX_MINUTES / 60} hours.` };
    const typed = form.websites.map((w) => w.trim()).filter((w) => w !== '');
    const unreadable = typed.find((w) => !parseSite(w));
    if (unreadable) return { error: `"${unreadable}" isn't a website address. Type it like docs.python.org/* or school.example/exam-page.` };
    // an app without a profile is given by where its program is on the lab computers
    const apps = (form.apps ?? []).map((app) => ('custom' in app ? { custom: { ...app.custom, image: app.custom.image.trim() } } : app));
    const notProgram = apps.find((app) => 'custom' in app && !isProgramPath(app.custom.image));
    if (notProgram && 'custom' in notProgram) return { error: `"${notProgram.custom.image}" isn't a program's place on a lab computer. Type it like C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe.` };
    const given = form.files ?? [];
    const badName = given.find((f) => !isSafeName(f.name) || f.name.includes('/'));
    if (badName) return { error: `"${badName.name}" can't be given: its name has a character that a lab computer can't store.` };
    if (new Set(given.map((f) => f.name.toLowerCase())).size !== given.length) return { error: 'Two of the files to give have the same name.' };

    // a file just chosen is looked at before anything is saved: one that can't be read any more mustn't leave
    // an exam behind that the form doesn't know it has made (the next Save would make a second one)
    for (const f of given) {
      if (f.path && !(await stat(f.path).then((info) => info.isFile(), () => false))) return { error: `"${f.name}" can't be read any more. Take it off the list and add it again.` };
    }

    let classId = form.classId;
    if (!classId) {
      const { students } = parseRoster(form.studentNames);
      if (form.className.trim() === '') return { error: 'Name the class.' };
      if (form.className.trim().length > MAX_NAME) return { error: `The class's name is too long: ${MAX_NAME} letters at most.` };
      if (students.length === 0) return { error: 'Type the students\' names, one on each line.' };
      classId = (await this.store.addClass(form.className.trim(), students)).id;
    }
    // a website's other hosts are recorded when it is added; one that is still on the list keeps what was recorded
    const before = form.id ? await this.store.exam(form.id) : undefined;
    const websites: Website[] = [];
    for (const url of typed) {
      const was = before?.websites.find((w) => w.url === url);
      websites.push(was ?? { url, hosts: await (this.options.record?.(parseSite(url)!.start).catch(() => []) ?? []) });
    }
    const exam = { title, teacher, classId, minutes: form.minutes, websites, apps };
    const now = (this.options.now ?? Date.now)();
    const id = before ? before.id : (await this.store.addExam(exam, now)).id;
    if (before) await this.store.changeExam(id, exam, now);

    // the files to give are kept with the exam: the ones just chosen are copied in, the ones taken off are removed
    const folder = this.givenFolder(id);
    await mkdir(folder, { recursive: true });
    const metas: FileMeta[] = [];
    for (const f of given) {
      const kept = join(folder, f.name);
      if (f.path) await copyFile(f.path, kept);
      const info = await stat(kept).catch(() => undefined);
      if (!info) return { error: `"${f.name}" can't be read any more. Take it off the list and add it again.` };
      metas.push({ name: f.name, bytes: info.size, sha256: await hashFile(kept) });
    }
    for (const old of await readdir(folder)) if (!given.some((f) => f.name === old)) await rm(join(folder, old), { force: true });
    await this.store.setExamFiles(id, metas);
    await this.refresh();
    return { id };
  }

  /** Saves the form and opens the exam for students. Answers with what is wrong, in words, if anything is. */
  async openExam(form: ExamForm): Promise<string | undefined> {
    if (this.room) return 'An exam is already open.';
    const saved = await this.saveExam(form);
    return 'error' in saved ? saved.error : this.openSaved(saved.id);
  }

  /** Opens a kept exam for students: a new run, with a new code. */
  async openSaved(examId: string): Promise<string | undefined> {
    if (this.room) return 'An exam is already open.';
    if (!(await this.store.exam(examId))) return 'That exam isn\'t kept any more.';
    this.watch(await Classroom.create(this.store, examId, this.roomOptions()));
    this.beacon.announce();
    await this.refresh();
    return undefined;
  }

  /** A copy of a kept exam, to change for another class or another term. */
  async copyExam(examId: string): Promise<void> {
    const exam = (await this.store.exams()).find((e) => e.id === examId);
    if (!exam) return;
    const copy = await this.store.addExam({ title: `${exam.title} (copy)`, teacher: exam.teacher, classId: exam.classId, minutes: exam.minutes, websites: exam.websites, apps: exam.apps }, (this.options.now ?? Date.now)());
    await cp(this.givenFolder(exam.id), this.givenFolder(copy.id), { recursive: true }).catch(() => undefined);
    await this.store.setExamFiles(copy.id, exam.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })));
    await this.refresh();
  }

  async deleteExam(examId: string): Promise<string | undefined> {
    if (this.room?.view().run.id && (await this.store.run(this.room.id))?.exam.id === examId) return 'This exam is open now.';
    if (!(await this.store.deleteExam(examId))) return 'This exam was run, and its hand-ins and log belong to it: it can\'t be deleted.';
    await rm(this.givenFolder(examId), { recursive: true, force: true });
    await this.refresh();
    return undefined;
  }

  /** A class (F-43): a new one, or the one that is changed. The list is as typed, pasted or read from a file. */
  async saveClass(change: { id?: string; name: string; list: string }): Promise<string | undefined> {
    const name = change.name.trim();
    const { students } = parseRoster(change.list);
    if (name === '') return 'Name the class.';
    if (name.length > MAX_NAME) return `The class's name is too long: ${MAX_NAME} letters at most.`;
    if (students.length === 0) return 'Type or paste the students\' names, one on each line.';
    if (this.current.classes.some((c) => c.id !== change.id && c.name.toLowerCase() === name.toLowerCase())) return `There is already a class called ${name}.`;
    if (change.id && this.room && this.room.view().run.endedAt === undefined && (await this.store.run(this.room.id))?.exam.classId === change.id) return 'This class is in the exam that is open now. Change it afterwards.';
    const kept = change.id ? await this.store.changeClass(change.id, name, students) : (await this.store.addClass(name, students), 0);
    await this.refresh();
    return kept > 0 ? `Saved. ${kept === 1 ? '1 student who was taken off stays' : `${kept} students who were taken off stay`} on the list: earlier exams have their work.` : undefined;
  }

  async deleteClass(classId: string): Promise<string | undefined> {
    if (!(await this.store.deleteClass(classId))) return 'An exam uses this class. Delete or change the exam first.';
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
    this.unwatch = room.onChange(() => void this.refresh('room').catch((error: unknown) => this.options.log?.('desk', 'the screens couldn\'t be brought up to date', error)));
  }

  /** Builds the state again and tells the screens. Changes that come while it is being built are one more turn —
   *  after a moment, so a whole lab changing at once is a few turns a second, not hundreds.
   *  `what`: `room` when only the run changed (a student's state, an event): the classes, the exams and the lab's
   *  apps are as they were, and aren't read again. */
  private refresh(what: 'all' | 'room' = 'all'): Promise<void> {
    if (what === 'all') this.library = undefined;
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    const every = this.options.refreshMs ?? REFRESH_MS;
    this.refreshing = (async () => {
      for (;;) {
        // not sooner after the last turn than `every`: the first change is shown at once, a stream of them a few
        // times a second
        const wait = this.builtAt + every - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.again = false;
        this.builtAt = Date.now();
        this.current = await this.build();
        for (const listener of this.listeners) listener(this.current);
        if (!this.again) break;
      }
    })().finally(() => void (this.refreshing = undefined));
    return this.refreshing;
  }

  /** What doesn't change while an exam runs: the classes, the kept exams, the lab's apps. Read once, and again
   *  only after one of them was changed. */
  private async shelf(): Promise<Pick<TeacherState, 'classes' | 'exams' | 'labApps' | 'defaults'>> {
    if (this.library) return this.library;
    const classes = await Promise.all((await this.store.classes()).map(async (c) => ({
      ...c, roster: (await this.store.students(c.id)).map((s) => ({ name: s.name, ...(s.email ? { email: s.email } : {}), ...(s.number !== null ? { number: s.number } : {}) })),
    })));
    const exams = (await this.store.exams()).map((e) => ({
      id: e.id, title: e.title, teacher: e.teacher, classId: e.classId, className: e.className, minutes: e.minutes, websites: e.websites.map((w) => w.url), apps: e.apps,
      files: e.files.map(({ name, bytes }) => ({ name, bytes })), updatedAt: e.updatedAt, runs: e.runs,
    }));
    const last = await this.store.lastExam();
    const made = { classes, exams, labApps: labApps((await this.store.inventory()).map((r) => r.installed)), defaults: { teacher: last?.teacher ?? '', classId: last?.classId } };
    // (changed again while it was being read: this isn't the one to keep)
    if (!this.again) this.library = made;
    return made;
  }

  /** The run's events so far: the ones that came since the last look are added to the ones already read. */
  private async eventsOf(runId: string, names: Map<string, string>): Promise<FeedItem[]> {
    if (this.seen?.runId !== runId) this.seen = { runId, lastId: 0, items: [] };
    const log = this.seen;
    for (const e of await this.store.eventsAfter(runId, log.lastId)) {
      log.items.push({ id: e.id, at: e.at, kind: e.kind, studentId: e.studentId ?? undefined, student: e.studentId ? names.get(e.studentId) : undefined, pc: e.pc ?? undefined, details: e.details });
      log.lastId = e.id;
    }
    return log.items;
  }

  private async build(): Promise<TeacherState> {
    const shelf = await this.shelf();
    const by = this.options.identity?.licence;
    const licence = by ? { name: by.name, school: by.school, id: by.id } : undefined;
    // (the run as it is now: it may be put away while the rest is being read)
    const room = this.room;
    if (!room) return { screen: 'make', ...shelf, licence, students: [], feed: [], events: [], files: {} };
    const { run, students } = room.view();
    const all = await this.eventsOf(run.id, new Map(students.map((s) => [s.id, s.name])));
    const feed = all.filter((e) => !(QUIET as readonly string[]).includes(e.kind)).slice(-FEED).reverse();
    const screen = run.endedAt !== undefined ? 'ended' : run.startedAt === undefined ? 'lobby' : 'live';
    // the files kept from each student (13b, 14): read again only when some were taken since, or the run's
    // state changed (a hand-in marks them)
    const mark = `${room.uploads} ${students.map((s) => s.state).join()}`;
    if (this.kept?.runId !== run.id || this.kept.mark !== mark) {
      const files: Record<string, KeptFile[]> = {};
      for (const [studentId, kept] of await this.store.runFiles(run.id)) files[studentId] = kept.map(({ name, bytes, kind }) => ({ name, bytes, kind }));
      this.kept = { runId: run.id, mark, files };
    }
    const files = this.kept.files;
    // (the screens get the newest events — every one of a school day's exam; the whole log is the exported one)
    return { screen, ...shelf, licence, run, students, feed, events: all.length > EVENTS_SHOWN ? all.slice(-EVENTS_SHOWN) : [...all], files };
  }
}
