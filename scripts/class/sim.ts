/**
 * The simulated classroom (MILESTONES §1.5): the real teacher's side — store, classroom, server, beacon — and any
 * number of students that are the real student's side without its screens, all in one process and talking over
 * real sockets on this computer. The stories in `stories/` and the tests drive it; `npm run class` shows it.
 *
 * Time can run faster than real time (`speed`): at 20, the 10 s of *no contact* take half a second.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../src/lib/protocol/messages';
import { StudentExam, BACKUP_MS, type Receipt } from '../../src/main/student/exam';
import { Session } from '../../src/main/student/session';
import { BeaconSender } from '../../src/main/teacher/beacon';
import { Classroom, type StudentView } from '../../src/main/teacher/classroom';
import { ClassroomServer } from '../../src/main/teacher/server';
import { Store, type EventRow } from '../../src/main/teacher/store/store';

/** The prototype's class (design/src): Year 10 A. */
export const YEAR_10_A = [
  'Sokha Chan', 'Dara Kim', 'Vannak Sok', 'Mealea Heng', 'Rithy Pov', 'Kosal Meas', 'Bopha Keo', 'Chanthy Ly', 'Sopheak Nhem', 'Pisey Tep',
  'Ratana Oum', 'Sovann Chea', 'Kunthea Sim', 'Veasna Ros', 'Sreyneang Phan', 'Makara Yim', 'Chenda Hok', 'Samnang Thach', 'Leakhena Mao',
  'Narith Seng', 'Socheata Var', 'Piseth Kong', 'Davy Em', 'Borey Sam', 'Sreymom Nget', 'Rotha Suon',
];

/** As many names as asked for: the prototype's class first, then Student 27, Student 28 … */
export const classOf = (n: number): string[] => Array.from({ length: n }, (_, i) => YEAR_10_A[i] ?? `Student ${i + 1}`);

export class SimClock {
  private readonly real = Date.now();
  constructor(readonly speed = 1, private readonly from = Date.now()) {}
  now = (): number => Math.round(this.from + (Date.now() - this.real) * this.speed);
  /** Waits this long on the exam's clock. */
  wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms / this.speed));
  }
  /** How long this takes for real. */
  ms(examMs: number): number {
    return Math.max(5, Math.round(examMs / this.speed));
  }
}

export interface SimOptions {
  /** how many students, or their names */
  students?: number | string[];
  title?: string;
  minutes?: number;
  speed?: number;
  code?: string;
  /** how often the students back up, on the exam's clock; by default every 2 minutes (F-22) */
  backupMs?: number;
  /** where everything is kept; by default a folder that is deleted afterwards */
  root?: string;
  port?: number;
  beacon?: { port: number; targets: string[] };
}

export class SimClassroom {
  readonly students: SimStudent[] = [];
  private beacon?: BeaconSender;

  private constructor(
    readonly store: Store, readonly room: Classroom, readonly server: ClassroomServer, readonly clock: SimClock,
    readonly root: string, private readonly ownsRoot: boolean, readonly code: string, readonly backupMs: number,
  ) {}

  static async open(options: SimOptions = {}): Promise<SimClassroom> {
    const root = options.root ?? await mkdtemp(join(tmpdir(), 'exammode-class-'));
    const clock = new SimClock(options.speed ?? 1);
    const handIns = join(root, 'Hand-ins');
    await mkdir(handIns, { recursive: true });
    const store = new Store(join(root, 'exammode.db'));
    const names = typeof options.students === 'object' ? options.students : classOf(options.students ?? 4);
    const cls = await store.addClass('Year 10 A', names.map((name, i) => ({ name, email: `${name.toLowerCase().replaceAll(' ', '.')}@school.edu`, number: i + 1 })));
    const exam = await store.addExam({ title: options.title ?? 'Year 10 ICT — Term 1 practical exam', teacher: 'Ms Srey Leak', classId: cls.id, minutes: options.minutes ?? 90 }, clock.now());
    const code = options.code ?? '4817';
    const room = await Classroom.create(store, exam.id, { handIns, now: clock.now, code });
    const server = new ClassroomServer({ handIns, port: options.port ?? 0, tickMs: clock.ms(1000) });
    server.add(room);
    await server.listen();
    const sim = new SimClassroom(store, room, server, clock, root, options.root === undefined, code, options.backupMs ?? BACKUP_MS);
    cls.students.forEach((s, i) => sim.students.push(new SimStudent(sim, s.id, s.name, `PC-${String(i + 1).padStart(2, '0')}`)));
    if (options.beacon) {
      sim.beacon = new BeaconSender(() => server.listings(), { port: options.beacon.port, targets: () => options.beacon!.targets, everyMs: clock.ms(2000) });
      await sim.beacon.start();
    }
    return sim;
  }

  student(name: string): SimStudent {
    const found = this.students.find((s) => s.name === name);
    if (!found) throw new Error(`No student ${name}`);
    return found;
  }

  /** How the teacher's laptop sees a student. */
  view(name: string): StudentView {
    return this.room.view().students.find((s) => s.name === name)!;
  }

  /** The log, for one student or for everyone. */
  async log(name?: string): Promise<EventRow[]> {
    const id = name ? this.student(name).id : undefined;
    return (await this.store.events(this.room.id)).filter((e) => !id || e.studentId === id);
  }

  /** Every student joins, passes the checks and locks. */
  async everyoneReady(): Promise<void> {
    await Promise.all(this.students.map((s) => s.sit()));
    await this.until(() => this.room.view().students.every((s) => s.state === 'ready'));
  }

  /** Waits until `check` is true (or stops throwing). */
  async until(check: () => unknown, ms = 10_000): Promise<void> {
    const end = Date.now() + ms;
    for (;;) {
      let failure: unknown = new Error(`Still not true after ${ms} ms: ${check}`);
      try {
        if (await check()) return;
      } catch (error) {
        failure = error;
      }
      if (Date.now() > end) throw failure;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async close(): Promise<void> {
    for (const s of this.students) s.stop();
    await this.beacon?.stop();
    await this.server.close();
    this.store.close();
    if (this.ownsRoot) await rm(this.root, { recursive: true, force: true, maxRetries: 5 });
  }
}

export class SimStudent {
  session?: Session;
  exam?: StudentExam;
  /** a pulled network cable: nothing gets through */
  unplugged = false;
  private bootId = randomUUID();

  constructor(private readonly sim: SimClassroom, readonly id: string, readonly name: string, public pc: string) {}

  /** The Exam folder on this student's lab computer. */
  get folder(): string {
    return join(this.sim.root, 'lab', this.pc, 'ExamMode', this.name);
  }

  /** ExamMode starts on the lab computer and asks to join. Every start is a new ExamMode (a new instanceId). */
  async join(over: { code?: string; pc?: string; studentId?: string } = {}) {
    const { clock, server, room } = this.sim;
    if (over.pc) this.pc = over.pc;
    this.session = new Session({
      host: '127.0.0.1', port: server.port, runId: room.id, studentId: over.studentId ?? this.id, code: over.code ?? this.sim.code,
      pc: this.pc, instanceId: randomUUID(), bootId: this.bootId,
      beatMs: clock.ms(2000), retryMs: clock.ms(2000), clockMs: clock.ms(250), now: clock.now,
      connect: (url) => {
        if (this.unplugged) throw new Error('unplugged');
        return new WebSocket(url);
      },
    });
    this.exam = new StudentExam(this.session, {
      folder: this.folder, backupMs: clock.ms(this.sim.backupMs), retryMs: clock.ms(2000),
      send: (...args) => (this.unplugged ? Promise.reject(new Error('unplugged')) : fetch(...args)),
    });
    return this.session.join();
  }

  /** Joins, passes the checks and locks: ready for Start (or, after Start, in the exam). */
  async sit(): Promise<void> {
    const reply = await this.join();
    if (reply !== 'joined') throw new Error(`${this.name} was refused: ${reply}`);
    this.session!.checks([{ check: 'oneScreen', ok: true }, { check: 'noRemote', ok: true }, { check: 'notVirtual', ok: true }]);
    this.session!.ready();
  }

  /** Saves a file in the Exam folder. */
  async write(name: string, content: string): Promise<void> {
    const path = join(this.folder, ...name.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  unplug(): void {
    this.unplugged = true;
    this.session?.drop();
  }

  plug(): void {
    this.unplugged = false;
  }

  /** ExamMode is killed, or crashes. With the Guard running, the teacher's laptop is told at once (F-20). */
  async kill(guard = true): Promise<void> {
    const token = this.session?.token;
    const instanceId = this.session?.seat.instanceId;
    this.stop();
    if (!guard || !token || !instanceId) return;
    await fetch(`${this.session!.base}/stopped`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: PROTOCOL_VERSION, type: 'stopped', token, pc: this.pc, instanceId, at: this.sim.clock.now() }),
    });
  }

  /** The computer is switched off and on again: the next ExamMode has a new bootId. */
  async reboot(): Promise<void> {
    await this.kill(false);
    this.bootId = randomUUID();
  }

  handIn(): Promise<Receipt | undefined> {
    return this.exam!.handIn();
  }

  /** ExamMode is gone without a word. */
  stop(): void {
    this.exam?.stop();
    this.session?.close();
  }
}
