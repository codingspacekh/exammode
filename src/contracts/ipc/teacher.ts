/**
 * The teacher's screens' API (architecture §2.2): what the main process tells them, and what they can ask for. The
 * main process owns the state; a screen only shows it and passes on what was pressed. Types only.
 */
import type { LabApps } from '@domain/profiles/inventory';
import type { Website } from '@domain/browser/sites';
import type { RosterStudent } from '@domain/exam/roster';
import type { ExamApp } from '@domain/profiles/exam-apps';
import type { CheckName } from '@domain/lockdown/checks';
import type { AttemptState, HandInHow, LeftHow } from '@domain/session/attempt';

export interface StudentView {
  id: string;
  name: string;
  state: AttemptState;
  pc?: string;
  /** the app in front, from the last beat */
  front?: string;
  /** a connection is open; what counts for *no contact* is the beats */
  connected: boolean;
  warnings: number;
  extraMinutes: number;
  joinedAt?: number;
  endsAt?: number;
  leftAt?: number;
  leftHow?: LeftHow;
  /** the computer a refused join waits on, for Let back in or Keep out */
  asksBackFrom?: string;
  handedInAt?: number;
  handedInHow?: HandInHow;
  receipt?: string;
  /** how many files the teacher's laptop has from this student */
  files: number;
  /** the checks this student's computer didn't pass (12: *can't start*) */
  failed: CheckName[];
}

export interface RunView {
  id: string;
  code: string;
  title: string;
  teacher: string;
  className: string;
  minutes: number;
  extraMinutes: number;
  websites: Website[];
  folder: string;
  openedAt: number;
  startedAt?: number;
  endsAt?: number;
  endedAt?: number;
}

/** A line of *What's happening* (13). */
export interface FeedItem { id: number; at: number; kind: string; studentId?: string; student?: string; pc?: string; details: Record<string, unknown> }

/** A file the teacher's laptop has from a student: from the hand-in, or the latest backup. */
export interface KeptFile { name: string; bytes: number; kind: 'backup' | HandInHow }

export interface ClassChoice { id: string; name: string; students: number; roster: RosterStudent[] }

/** A file to give every student: one the exam already has, or (with `path`) one just chosen on this computer. */
export interface GivenFile { name: string; bytes: number; path?: string }

/** An exam that is kept: it can be opened again, changed or copied (F-35). */
export interface SavedExam {
  id: string; title: string; teacher: string; classId: string; className: string; minutes: number;
  websites: string[]; apps: ExamApp[]; files: GivenFile[]; updatedAt: number;
  /** how many times it has been run: an exam that was run can't be deleted, its hand-ins hang on it */
  runs: number;
}

/** Make an exam (11): a title, a class, the time, where the questions are, the files to give and the apps. */
export interface ExamForm {
  /** the exam that is being changed; none: a new one */
  id?: string;
  teacher: string;
  title: string;
  /** a class that is already kept; or a new one, by name with its students one a line */
  classId?: string;
  className: string;
  studentNames: string;
  minutes: number;
  /** empty: the questions are on paper (no exam browser) */
  websites: string[];
  /** the files to give every student (F-33) */
  files?: GivenFile[];
  /** the apps students may use (F-31); none: only the questions */
  apps?: ExamApp[];
}

export interface TeacherState {
  screen: 'make' | 'lobby' | 'live' | 'ended';
  classes: ClassChoice[];
  /** the exams that are kept, the one changed last first */
  exams: SavedExam[];
  /** the lab computers' installed apps, for Add an app (11b) */
  labApps: LabApps;
  /** what the form starts with: the last exam's teacher and class */
  defaults: Pick<ExamForm, 'teacher' | 'classId'>;
  run?: RunView;
  students: StudentView[];
  /** what's happening, newest first, without what the lists already show */
  /** the teacher's licence: who the author says this is (F-44); none: a development build's teacher */
  licence?: { name: string; school: string; id: string };
  feed: FeedItem[];
  /** every event of the run, oldest first: the students' timelines (13b) */
  events: FeedItem[];
  /** the files kept from each student, by student id (14) */
  files: Record<string, KeptFile[]>;
}

export interface TeacherApi {
  get(): Promise<TeacherState>;
  onState(listener: (state: TeacherState) => void): () => void;
  /** Saves the form and opens the exam for students. Answers with what is wrong with the form, if anything. */
  open(form: ExamForm): Promise<string | undefined>;
  /** Saves an exam without opening it (F-35). */
  saveExam(form: ExamForm): Promise<string | undefined>;
  /** Opens a kept exam for students again. */
  openSaved(examId: string): Promise<string | undefined>;
  copyExam(examId: string): Promise<void>;
  deleteExam(examId: string): Promise<string | undefined>;
  /** Asks for files on this computer, to give with an exam. */
  chooseFiles(): Promise<GivenFile[]>;
  /** A class (F-43): its name and its list, as typed, pasted or read from a file. */
  saveClass(change: { id?: string; name: string; list: string }): Promise<string | undefined>;
  deleteClass(classId: string): Promise<string | undefined>;
  /** Asks for a spreadsheet file (CSV) and answers with its text, for the class's list. */
  readListFile(): Promise<string | undefined>;
  start(): Promise<void>;
  end(): Promise<void>;
  /** Let back in / Keep out (F-40), with the reason for the log */
  letBackIn(studentId: string, reason: string): Promise<void>;
  keepOut(studentId: string, reason: string): Promise<void>;
  /** more time for one student, or for everyone (F-41) */
  addTime(minutes: number, studentId?: string): Promise<void>;
  /** back to *open an exam*, once the run has ended */
  done(): Promise<void>;
  /** the run's folder in Hand-ins, or one student's */
  openFolder(studentId?: string): Promise<void>;
  /** Export the log (CSV): asks where to save it. Answers with the file, if one was written */
  exportLog(): Promise<string | undefined>;
}
