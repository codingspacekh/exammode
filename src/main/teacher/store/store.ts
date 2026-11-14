/**
 * The teacher's store (architecture §2.11): one SQLite file, read and written through Drizzle. SQLite is Node's own
 * (`node:sqlite`), so nothing has to be compiled for Electron. A run's data is on disk as it happens, so it survives
 * the teacher's laptop restarting (N-05).
 */
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { FileMeta } from '@lib/protocol/messages';
import type { Attempt, HandInHow } from '@lib/session/attempt';
import * as schema from './schema';

const migrations = Object.entries(import.meta.glob<string>('./migrations/*.sql', { query: '?raw', import: 'default', eager: true }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

export type StudentRow = typeof schema.students.$inferSelect;
export type ExamRow = typeof schema.exams.$inferSelect;
export type RunRow = typeof schema.runs.$inferSelect;
export type EventRow = typeof schema.events.$inferSelect;
export type FileRow = typeof schema.handinFiles.$inferSelect;
export type FileKind = FileRow['kind'];

export interface NewStudent { name: string; email?: string; number?: number }
export interface NewExam { title: string; teacher: string; classId: string; minutes: number; websites?: string[] }
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
    this.sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
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

  async addClass(name: string, students: NewStudent[]): Promise<{ id: string; students: StudentRow[] }> {
    const id = randomUUID();
    await this.db.insert(schema.classes).values({ id, name });
    const rows = students.map((s) => ({ id: randomUUID(), classId: id, name: s.name, email: s.email ?? null, number: s.number ?? null }));
    if (rows.length > 0) await this.db.insert(schema.students).values(rows);
    return { id, students: rows };
  }

  students(classId: string): Promise<StudentRow[]> {
    return this.db.select().from(schema.students).where(eq(schema.students.classId, classId)).orderBy(asc(schema.students.name));
  }

  async addExam(exam: NewExam, at: number): Promise<ExamRow> {
    const row: ExamRow = { id: randomUUID(), ...exam, apps: [], websites: exam.websites ?? [], rules: {}, updatedAt: at };
    await this.db.insert(schema.exams).values(row);
    return row;
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
