/**
 * The teacher's side of ExamMode without its windows: the store, the server, the beacon and the run that is open,
 * and the one state the teacher's screens show (architecture §2.2). M3: open an exam (11, minimal), the lobby (12),
 * the live view (13).
 */
import { copyFile, cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseSite, type Website } from '@lib/browser/sites';
import { parseRoster } from '@lib/exam/roster';
import { isSafeName } from '@lib/files/names';
import type { FileMeta } from '@lib/protocol/messages';
import type { ExamForm, FeedItem, KeptFile, TeacherState } from '@lib/app/state';
import { logCsv } from '@lib/exam/log';
import { BeaconSender, type BeaconOptions } from './beacon';
import { hashFile } from '../student/files';
import { Classroom, type ClassroomOptions } from './classroom';
import { ClassroomServer } from './server';
import { Store } from './store/store';

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
  private current: TeacherState = { screen: 'make', classes: [], exams: [], defaults: { teacher: '' }, students: [], feed: [], events: [], files: {} };
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
    if (!Number.isInteger(form.minutes) || form.minutes < 1 || form.minutes > MAX_MINUTES) return { error: `The time is between 1 minute and ${MAX_MINUTES / 60} hours.` };
    const typed = form.websites.map((w) => w.trim()).filter((w) => w !== '');
    const unreadable = typed.find((w) => !parseSite(w));
    if (unreadable) return { error: `"${unreadable}" isn't a website address. Type it like docs.python.org/* or school.example/exam-page.` };
    const given = form.files ?? [];
    const badName = given.find((f) => !isSafeName(f.name) || f.name.includes('/'));
    if (badName) return { error: `"${badName.name}" can't be given: its name has a character that a lab computer can't store.` };
    if (new Set(given.map((f) => f.name.toLowerCase())).size !== given.length) return { error: 'Two of the files to give have the same name.' };

    let classId = form.classId;
    if (!classId) {
      const { students } = parseRoster(form.studentNames);
      if (form.className.trim() === '') return { error: 'Name the class.' };
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
    const exam = { title, teacher, classId, minutes: form.minutes, websites };
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
    const copy = await this.store.addExam({ title: `${exam.title} (copy)`, teacher: exam.teacher, classId: exam.classId, minutes: exam.minutes, websites: exam.websites }, (this.options.now ?? Date.now)());
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
    const classes = await Promise.all((await this.store.classes()).map(async (c) => ({
      ...c, roster: (await this.store.students(c.id)).map((s) => ({ name: s.name, ...(s.email ? { email: s.email } : {}), ...(s.number !== null ? { number: s.number } : {}) })),
    })));
    const exams = (await this.store.exams()).map((e) => ({
      id: e.id, title: e.title, teacher: e.teacher, classId: e.classId, className: e.className, minutes: e.minutes, websites: e.websites.map((w) => w.url),
      files: e.files.map(({ name, bytes }) => ({ name, bytes })), updatedAt: e.updatedAt, runs: e.runs,
    }));
    const last = await this.store.lastExam();
    const defaults = { teacher: last?.teacher ?? '', classId: last?.classId };
    if (!this.room) return { screen: 'make', classes, exams, defaults, students: [], feed: [], events: [], files: {} };
    const { run, students } = this.room.view();
    const names = new Map(students.map((s) => [s.id, s.name]));
    const events: FeedItem[] = (await this.store.events(run.id))
      .map((e) => ({ id: e.id, at: e.at, kind: e.kind, studentId: e.studentId ?? undefined, student: e.studentId ? names.get(e.studentId) : undefined, pc: e.pc ?? undefined, details: e.details }));
    const feed = events.filter((e) => !QUIET.includes(e.kind)).slice(-FEED).reverse();
    const files: Record<string, KeptFile[]> = {};
    for (const [studentId, kept] of await this.store.runFiles(run.id)) files[studentId] = kept.map(({ name, bytes, kind }) => ({ name, bytes, kind }));
    const screen = run.endedAt !== undefined ? 'ended' : run.startedAt === undefined ? 'lobby' : 'live';
    return { screen, classes, exams, defaults, run, students, feed, events, files };
  }
}
