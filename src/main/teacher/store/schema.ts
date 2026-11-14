/**
 * The teacher's data (architecture §2.11): SQLite in the teacher's app data folder, through Drizzle. Times are ms on
 * the teacher's clock. After changing a table: `npm run db:generate`, which writes the next file in `migrations/`.
 */
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Website } from '@lib/browser/sites';
import type { ExamApp } from '@lib/profiles/exam-apps';
import type { AttemptState, CheckResult, HandInHow, LeftHow, Seat } from '@lib/session/attempt';

export const classes = sqliteTable('classes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

export const students = sqliteTable('students', {
  id: text('id').primaryKey(),
  classId: text('class_id').notNull().references(() => classes.id),
  name: text('name').notNull(),
  email: text('email'),
  number: integer('number'),
}, (t) => [uniqueIndex('students_class_email').on(t.classId, t.email)]);

export const exams = sqliteTable('exams', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  teacher: text('teacher').notNull(),
  classId: text('class_id').notNull().references(() => classes.id),
  minutes: integer('minutes').notNull(),
  apps: text('apps', { mode: 'json' }).$type<ExamApp[]>().notNull(),
  websites: text('websites', { mode: 'json' }).$type<Website[]>().notNull(),
  rules: text('rules', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const examFiles = sqliteTable('exam_files', {
  examId: text('exam_id').notNull().references(() => exams.id),
  name: text('name').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
}, (t) => [primaryKey({ columns: [t.examId, t.name] })]);

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  examId: text('exam_id').notNull().references(() => exams.id),
  code: text('code').notNull(),
  /** the run's folder in Hand-ins, fixed when the run is opened */
  folder: text('folder').notNull(),
  openedAt: integer('opened_at').notNull(),
  startedAt: integer('started_at'),
  /** time added for everyone (F-41); the end is worked out from Start, the exam's minutes and this */
  extraMinutes: integer('extra_minutes').notNull().default(0),
  endedAt: integer('ended_at'),
});

export const attempts = sqliteTable('attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id),
  studentId: text('student_id').notNull().references(() => students.id),
  state: text('state').$type<AttemptState>().notNull(),
  /** proves which attempt a message is about; new with every accepted join */
  token: text('token'),
  pc: text('pc'),
  instanceId: text('instance_id'),
  bootId: text('boot_id'),
  joinedAt: integer('joined_at'),
  checks: text('checks', { mode: 'json' }).$type<CheckResult[]>(),
  leftAt: integer('left_at'),
  leftHow: text('left_how').$type<LeftHow>(),
  asksBack: text('asks_back', { mode: 'json' }).$type<Seat>(),
  mayReturn: integer('may_return', { mode: 'boolean' }),
  extraMinutes: integer('extra_minutes').notNull().default(0),
  warnings: integer('warnings').notNull().default(0),
  handedInAt: integer('handed_in_at'),
  handedInHow: text('handed_in_how').$type<HandInHow>(),
  receipt: text('receipt'),
}, (t) => [uniqueIndex('attempts_run_student').on(t.runId, t.studentId), index('attempts_token').on(t.token)]);

/** The log: append only. */
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id),
  studentId: text('student_id'),
  pc: text('pc'),
  at: integer('at').notNull(),
  kind: text('kind').notNull(),
  details: text('details', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
}, (t) => [index('events_run').on(t.runId, t.id)]);

/** The latest copy the teacher has of each file: from a backup, or from the hand-in. */
export const handinFiles = sqliteTable('handin_files', {
  attemptId: integer('attempt_id').notNull().references(() => attempts.id),
  name: text('name').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  kind: text('kind').$type<'backup' | HandInHow>().notNull(),
  at: integer('at').notNull(),
}, (t) => [primaryKey({ columns: [t.attemptId, t.name] })]);

export const inventory = sqliteTable('inventory', {
  pc: text('pc').primaryKey(),
  apps: text('apps', { mode: 'json' }).$type<unknown[]>().notNull(),
  at: integer('at').notNull(),
});
