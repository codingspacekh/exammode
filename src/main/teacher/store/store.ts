/**
 * The teacher's store (architecture §2.11): one SQLite file, read and written through Drizzle. SQLite is Node's own
 * (`node:sqlite`), so nothing has to be compiled for Electron. A run's data is on disk as it happens, so it survives
 * the teacher's laptop restarting (N-05).
 */
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { Website } from '@lib/browser/sites';
import type { FileMeta } from '@lib/protocol/messages';
import type { Attempt, HandInHow } from '@lib/session/attempt';
import { migrations } from './migrations/index';
import * as schema from './schema';

export type StudentRow = typeof schema.students.$inferSelect;
export type ExamRow = typeof schema.exams.$inferSelect;
export type RunRow = typeof schema.runs.$inferSelect;
export type EventRow = typeof schema.events.$inferSelect;
export type FileRow = typeof schema.handinFiles.$inferSelect;
export type FileKind = FileRow['kind'];

export interface NewStudent { name: string; email?: string; number?: number }
export interface NewExam { title: string; teacher: string; classId: string; minutes: number; websites?: Website[] }
export type ExamFileRow = typeof schema.examFiles.$inferSelect;
export interface RunInfo { run: RunRow; exam: ExamRow; className: string }
export interface LogEntry { studentId?: string; pc?: string; at: number; kind: string; details: Record<string, unknown> }
/** An attempt as it is kept: the rules' attempt, and what the classroom adds to it. */
export interface SavedAttempt { id: number; attempt: Attempt; token?: string; receipt?: string }

const orUndefined = <T>(value: T | null): T | undefined => value ?? undefined;

export class Store {
  private readonly sqlite: DatabaseSync;
  private readonly db;

  constructor(path: string) {
    this.sqlite = new DatabaseSync(path);
    // WAL with synchronous = NORMAL: a write is safe from ExamMode stopping at once, and from the power going
    // after the next flush(); the classroom flushes at the moments that matter (Start, a hand-in, the end)
    this.sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.migrate();
    this.db = drizzle(async (sql, params, method) => {
      const statement = this.sqlite.prepare(sql);
      if (method === 'run') {
        statement.run(...(params as SQLInputValue[]));
        return { rows: [] };
      }
      statement.setReturnArrays(true);
      const rows = statement.all(...(params as SQLInputValue[])) as unknown as unknown[][];
      return { rows: method === 'get' ? (rows[0] as unknown[]) : rows };
    }, { schema });
  }

  /** Each migration file once, in order; `user_version` counts the ones done. */
  private migrate(): void {
    const done = Number(this.sqlite.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    migrations.slice(done).forEach((sql, i) => {
      this.sqlite.exec('BEGIN');
      for (const statement of sql.split('--> statement-breakpoint')) this.sqlite.exec(statement);
      this.sqlite.exec(`PRAGMA user_version = ${done + i + 1}`);
      this.sqlite.exec('COMMIT');
    });
  }

  close(): void {
    this.sqlite.close();
  }

  /** Everything `work` writes is written together, or not at all: one visit to the disk for one thing that happened. */
  async together<T>(work: () => Promise<T>): Promise<T> {
    if (this.sqlite.isTransaction) return work();
    this.sqlite.exec('BEGIN');
    try {
      const result = await work();
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  /** Everything written so far is on the disk for good, even if the power goes (N-05). */
  flush(): void {
    this.sqlite.exec('PRAGMA wal_checkpoint(FULL)');
  }

  async addClass(name: string, students: NewStudent[]): Promise<{ id: string; students: StudentRow[] }> {
    const id = randomUUID();
    await this.db.insert(schema.classes).values({ id, name });
    const rows = students.map((s) => ({ id: randomUUID(), classId: id, name: s.name, email: s.email ?? null, number: s.number ?? null }));
    if (rows.length > 0) await this.db.insert(schema.students).values(rows);
    return { id, students: rows };
  }

  /** Changes a class: its name and its list. A student who is still on the list keeps their place in earlier
   *  exams; one who was taken off stays in the class only if an exam's records hang on them. Answers with how
   *  many were kept for that reason. */
  async changeClass(classId: string, name: string, students: NewStudent[]): Promise<number> {
    await this.db.update(schema.classes).set({ name }).where(eq(schema.classes.id, classId));
    const now = await this.students(classId);
    const same = (a: { name: string; email?: string | null }, b: { name: string; email?: string | null }) => (a.email && b.email ? a.email === b.email : a.name === b.name);
    const staying = new Set<string>();
    for (const s of students) {
      const was = now.find((n) => !staying.has(n.id) && same(n, s));
      if (was) {
        staying.add(was.id);
        await this.db.update(schema.students).set({ name: s.name, email: s.email ?? null, number: s.number ?? null }).where(eq(schema.students.id, was.id));
      } else await this.db.insert(schema.students).values({ id: randomUUID(), classId, name: s.name, email: s.email ?? null, number: s.number ?? null });
    }
    let kept = 0;
    for (const gone of now.filter((n) => !staying.has(n.id))) {
      const used = await this.db.select({ id: schema.attempts.id }).from(schema.attempts).where(eq(schema.attempts.studentId, gone.id)).limit(1);
      if (used.length > 0) kept++;
      else await this.db.delete(schema.students).where(eq(schema.students.id, gone.id));
    }
    return kept;
  }

  /** Deletes a class that no exam uses. False: an exam still does. */
  async deleteClass(classId: string): Promise<boolean> {
    const used = await this.db.select({ id: schema.exams.id }).from(schema.exams).where(eq(schema.exams.classId, classId)).limit(1);
    if (used.length > 0) return false;
    await this.db.delete(schema.students).where(eq(schema.students.classId, classId));
    await this.db.delete(schema.classes).where(eq(schema.classes.id, classId));
    return true;
  }

  students(classId: string): Promise<StudentRow[]> {
    return this.db.select().from(schema.students).where(eq(schema.students.classId, classId)).orderBy(asc(schema.students.name));
  }

  async addExam(exam: NewExam, at: number): Promise<ExamRow> {
    const row: ExamRow = { id: randomUUID(), ...exam, apps: [], websites: exam.websites ?? [], rules: {}, updatedAt: at };
    await this.db.insert(schema.exams).values(row);
    return row;
  }

  /** Changes a kept exam. */
  async changeExam(examId: string, exam: NewExam, at: number): Promise<void> {
    await this.db.update(schema.exams).set({ ...exam, websites: exam.websites ?? [], updatedAt: at }).where(eq(schema.exams.id, examId));
  }

  /** Every kept exam, the one changed last first, with its class's name and how often it was run. */
  async exams(): Promise<(ExamRow & { className: string; runs: number; files: ExamFileRow[] })[]> {
    const rows = await this.db.select({ exam: schema.exams, className: schema.classes.name }).from(schema.exams)
      .innerJoin(schema.classes, eq(schema.classes.id, schema.exams.classId)).orderBy(desc(schema.exams.updatedAt));
    const runs = await this.db.select({ examId: schema.runs.examId }).from(schema.runs);
    const files = await this.db.select().from(schema.examFiles).orderBy(asc(schema.examFiles.name));
    return rows.map(({ exam, className }) => ({ ...exam, className, runs: runs.filter((r) => r.examId === exam.id).length, files: files.filter((f) => f.examId === exam.id) }));
  }

  /** Deletes an exam that was never run. False: it was, and its hand-ins hang on it. */
  async deleteExam(examId: string): Promise<boolean> {
    const run = await this.db.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.examId, examId)).limit(1);
    if (run.length > 0) return false;
    await this.db.delete(schema.examFiles).where(eq(schema.examFiles.examId, examId));
    await this.db.delete(schema.exams).where(eq(schema.exams.id, examId));
    return true;
  }

  /** The files an exam gives every student (F-33). */
  examFiles(examId: string): Promise<ExamFileRow[]> {
    return this.db.select().from(schema.examFiles).where(eq(schema.examFiles.examId, examId)).orderBy(asc(schema.examFiles.name));
  }

  async setExamFiles(examId: string, files: FileMeta[]): Promise<void> {
    await this.db.delete(schema.examFiles).where(eq(schema.examFiles.examId, examId));
    if (files.length > 0) await this.db.insert(schema.examFiles).values(files.map((f) => ({ examId, ...f })));
  }

  /** Every class, with how many students it has. */
  async classes(): Promise<{ id: string; name: string; students: number }[]> {
    const all = await this.db.select().from(schema.classes).orderBy(asc(schema.classes.name));
    const students = await this.db.select({ classId: schema.students.classId }).from(schema.students);
    return all.map((c) => ({ ...c, students: students.filter((s) => s.classId === c.id).length }));
  }

  /** The exam made last: what the next one starts from. */
  async lastExam(): Promise<ExamRow | undefined> {
    const [found] = await this.db.select().from(schema.exams).orderBy(desc(schema.exams.updatedAt)).limit(1);
    return found;
  }

  /** The files kept from each student of a run, by student. */
  async runFiles(runId: string): Promise<Map<string, FileRow[]>> {
    const rows = await this.db.select({ studentId: schema.attempts.studentId, file: schema.handinFiles })
      .from(schema.handinFiles).innerJoin(schema.attempts, eq(schema.attempts.id, schema.handinFiles.attemptId))
      .where(eq(schema.attempts.runId, runId)).orderBy(asc(schema.handinFiles.name));
    const files = new Map<string, FileRow[]>();
    for (const r of rows) files.set(r.studentId, [...(files.get(r.studentId) ?? []), r.file]);
    return files;
  }

  /** How many files the teacher's laptop has from each student of a run. */
  async fileCounts(runId: string): Promise<Map<string, number>> {
    const rows = await this.db.select({ studentId: schema.attempts.studentId, kind: schema.handinFiles.kind })
      .from(schema.handinFiles).innerJoin(schema.attempts, eq(schema.attempts.id, schema.handinFiles.attemptId)).where(eq(schema.attempts.runId, runId));
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.studentId, (counts.get(r.studentId) ?? 0) + 1);
    return counts;
  }

  async exam(examId: string): Promise<ExamRow | undefined> {
    const [found] = await this.db.select().from(schema.exams).where(eq(schema.exams.id, examId));
    return found;
  }

  async openRun(examId: string, run: { code: string; folder: string; at: number }): Promise<RunRow> {
    const row: RunRow = { id: randomUUID(), examId, code: run.code, folder: run.folder, openedAt: run.at, startedAt: null, extraMinutes: 0, endedAt: null };
    await this.db.insert(schema.runs).values(row);
    return row;
  }

  async run(runId: string): Promise<RunInfo | undefined> {
    const [found] = await this.db.select({ run: schema.runs, exam: schema.exams, className: schema.classes.name })
      .from(schema.runs)
      .innerJoin(schema.exams, eq(schema.exams.id, schema.runs.examId))
      .innerJoin(schema.classes, eq(schema.classes.id, schema.exams.classId))
      .where(eq(schema.runs.id, runId));
    return found;
  }

  /** Runs that were not ended: the ones to open again after the teacher's laptop restarted (N-05). */
  runsNotEnded(): Promise<RunRow[]> {
    return this.db.select().from(schema.runs).where(isNull(schema.runs.endedAt)).orderBy(asc(schema.runs.openedAt));
  }

  async updateRun(runId: string, change: Partial<Pick<RunRow, 'startedAt' | 'extraMinutes' | 'endedAt'>>): Promise<void> {
    await this.db.update(schema.runs).set(change).where(eq(schema.runs.id, runId));
  }

  /** Every attempt of a run, by student. When each was last heard from isn't kept: it is counted again (N-05). */
  async attempts(runId: string): Promise<Map<string, SavedAttempt>> {
    const rows = await this.db.select().from(schema.attempts).where(eq(schema.attempts.runId, runId));
    return new Map(rows.map((r) => [r.studentId, {
      id: r.id,
      token: orUndefined(r.token),
      receipt: orUndefined(r.receipt),
      attempt: {
        state: r.state,
        pc: orUndefined(r.pc),
        instanceId: orUndefined(r.instanceId),
        bootId: orUndefined(r.bootId),
        joinedAt: orUndefined(r.joinedAt),
        checks: orUndefined(r.checks),
        leftAt: orUndefined(r.leftAt),
        leftHow: orUndefined(r.leftHow),
        asksBack: orUndefined(r.asksBack),
        mayReturn: orUndefined(r.mayReturn),
        extraMinutes: r.extraMinutes,
        warnings: r.warnings,
        handedInAt: orUndefined(r.handedInAt),
        handedInHow: orUndefined(r.handedInHow),
      },
    }]));
  }

  /** Writes an attempt as it is now, and returns its row's id. */
  async saveAttempt(runId: string, studentId: string, a: Attempt, extra: { token?: string; receipt?: string } = {}): Promise<number> {
    const values = {
      state: a.state,
      token: extra.token ?? null,
      pc: a.pc ?? null,
      instanceId: a.instanceId ?? null,
      bootId: a.bootId ?? null,
      joinedAt: a.joinedAt ?? null,
      checks: a.checks ?? null,
      leftAt: a.leftAt ?? null,
      leftHow: a.leftHow ?? null,
      asksBack: a.asksBack ?? null,
      mayReturn: a.mayReturn ?? null,
      extraMinutes: a.extraMinutes,
      warnings: a.warnings,
      handedInAt: a.handedInAt ?? null,
      handedInHow: a.handedInHow ?? null,
      receipt: extra.receipt ?? null,
    };
    const [row] = await this.db.insert(schema.attempts).values({ runId, studentId, ...values })
      .onConflictDoUpdate({ target: [schema.attempts.runId, schema.attempts.studentId], set: values })
      .returning({ id: schema.attempts.id });
    return row!.id;
  }

  async log(runId: string, entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.insert(schema.events).values(entries.map((e) => ({ runId, studentId: e.studentId ?? null, pc: e.pc ?? null, at: e.at, kind: e.kind, details: e.details })));
  }

  events(runId: string): Promise<EventRow[]> {
    return this.db.select().from(schema.events).where(eq(schema.events.runId, runId)).orderBy(asc(schema.events.id));
  }

  /** The latest copy of each file: a newer one takes the older one's place. */
  async saveFiles(attemptId: number, files: FileMeta[], kind: FileKind, at: number): Promise<void> {
    for (const f of files) {
      const values = { bytes: f.bytes, sha256: f.sha256, kind, at };
      await this.db.insert(schema.handinFiles).values({ attemptId, name: f.name, ...values })
        .onConflictDoUpdate({ target: [schema.handinFiles.attemptId, schema.handinFiles.name], set: values });
    }
  }

  files(attemptId: number): Promise<FileRow[]> {
    return this.db.select().from(schema.handinFiles).where(eq(schema.handinFiles.attemptId, attemptId)).orderBy(asc(schema.handinFiles.name));
  }

  /** The files of a hand-in: what was handed in, without the earlier backups it replaced. */
  handedIn(attemptId: number, how: HandInHow): Promise<FileRow[]> {
    return this.db.select().from(schema.handinFiles)
      .where(and(eq(schema.handinFiles.attemptId, attemptId), eq(schema.handinFiles.kind, how))).orderBy(asc(schema.handinFiles.name));
  }
}
