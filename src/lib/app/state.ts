/**
 * What the screens are told, and what they can ask for: the shape of the preload API (architecture §2.2). The main
 * process owns the state; a screen only shows it and passes on what was pressed. Types only.
 */
import type { Website } from '../browser/sites';
import type { AttemptState, HandInHow, LeftHow } from '../session/attempt';

// ── the teacher's side ──────────────────────────────────────────────────────────────────────────────────────────

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
export interface FeedItem { id: number; at: number; kind: string; student?: string; pc?: string; details: Record<string, unknown> }

export interface ClassChoice { id: string; name: string; students: number }

/** The minimal *open an exam* of M3: a title, a class, the time, and where the questions are. */
export interface ExamForm {
  teacher: string;
  title: string;
  /** a class that is already kept; or a new one, by name with its students one a line */
  classId?: string;
  className: string;
  studentNames: string;
  minutes: number;
  /** empty: the questions are on paper (no exam browser) */
  websites: string[];
}

export interface TeacherState {
  screen: 'make' | 'lobby' | 'live';
  classes: ClassChoice[];
  /** what the form starts with: the last exam's teacher and class */
  defaults: Pick<ExamForm, 'teacher' | 'classId'>;
  run?: RunView;
  students: StudentView[];
  feed: FeedItem[];
}

export interface TeacherApi {
  get(): Promise<TeacherState>;
  onState(listener: (state: TeacherState) => void): () => void;
  /** Opens the exam for students. Answers with what is wrong with the form, if anything. */
  open(form: ExamForm): Promise<string | undefined>;
  start(): Promise<void>;
  end(): Promise<void>;
  /** back to *open an exam*, once the run has ended */
  done(): Promise<void>;
  openFolder(): Promise<void>;
}

// ── the student's side ──────────────────────────────────────────────────────────────────────────────────────────

/** An exam that is open on the classroom network (01). */
export interface FoundExam { runId: string; title: string; teacher: string; class: string; minutes?: number; host: string; port: number }
export interface Name { id: string; name: string; email?: string }
export interface FileLine { name: string; bytes: number; modified: number }
export type JoinError = 'codeWrong' | 'nameTaken' | 'notInClass' | 'left' | 'keptOut' | 'handedIn' | 'notJoined' | 'ended' | 'update' | 'unreachable';

export interface StudentState {
  screen: 'join' | 'waiting' | 'exam' | 'handIn' | 'handedIn';
  /** this computer's name */
  pc: string;
  found: FoundExam[];
  /** the exam chosen on 01, and its class list */
  picked?: string;
  names: Name[];
  joining: boolean;
  joinError?: JoinError;
  exam?: { runId: string; title: string; teacher: string; minutes: number; hasQuestions: boolean };
  student?: Name;
  /** the end, on the teacher's clock; `clockOffset` is what to add to this computer's clock to get it */
  endsAt?: number;
  clockOffset: number;
  /** false: the teacher's computer can't be reached (10b) */
  contact: boolean;
  /** 09: what will go, and what was given and left alone */
  handIn?: { files: FileLine[]; unchanged: FileLine[] };
  handingIn: boolean;
  receipt?: { code: string; files: { name: string; bytes: number }[]; at: number; byItself: boolean };
}

export interface StudentApi {
  get(): Promise<StudentState>;
  onState(listener: (state: StudentState) => void): () => void;
  pick(runId: string): Promise<void>;
  /** the teacher's computer name, typed in when no exam is found (F-01) */
  lookAt(host: string): Promise<void>;
  join(studentId: string, code: string): Promise<void>;
  /** Hand in… : lists the files (09) */
  askHandIn(): Promise<void>;
  keepWorking(): Promise<void>;
  handIn(): Promise<void>;
  /** Finish (09b): back to how it was */
  finish(): Promise<void>;
  showQuestions(): Promise<void>;
  openFolder(): Promise<void>;
}

// ── the exam browser ────────────────────────────────────────────────────────────────────────────────────────────

export interface BrowserTab { id: number; title: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; /** the host of a page that isn't part of the exam (07b) */ blocked?: string }
export interface BrowserState { tabs: BrowserTab[]; active: number; sites: string[] }

export interface BrowserApi {
  get(): Promise<BrowserState>;
  onState(listener: (state: BrowserState) => void): () => void;
  select(tab: number): Promise<void>;
  close(tab: number): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  /** from *This page isn't part of the exam*: back to the questions */
  toQuestions(): Promise<void>;
}

/** `window.exammode`, set by the preload script. */
export interface ExamModeApi {
  platform: string;
  /** which window this is */
  view: 'student' | 'teacher' | 'bar' | 'browser';
  student?: StudentApi;
  teacher?: TeacherApi;
  browser?: BrowserApi;
}
