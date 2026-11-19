/**
 * A lab computer's screens' API (architecture §2.2): what the main process tells them, and what they can ask for.
 * Types only.
 */
import type { AppToClose, Check } from '@domain/lockdown/checks';
import type { LeftInfo, RefusedReason } from '../network/messages';

/** An exam that is open on the classroom network (01). */
export interface FoundExam { runId: string; title: string; teacher: string; class: string; minutes?: number; host: string; port: number; /** the licensed teacher's key (F-44) */ teacherKey?: string }
export interface Name { id: string; name: string; email?: string }
export interface FileLine { name: string; bytes: number; modified: number }
/** Why a join didn't happen: the teacher's laptop's refusal, or no answer at all. */
export type JoinError = RefusedReason | 'unreachable';

export interface StudentState {
  /** `checks`: 02 · `leave`: 08 · `cantJoin`: 10, waiting for the teacher */
  screen: 'join' | 'checks' | 'waiting' | 'exam' | 'handIn' | 'leave' | 'handedIn' | 'cantJoin';
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
  /** false: the teacher's computer can't be reached (10b); `lostAt`: since when, on this computer's clock */
  contact: boolean;
  lostAt?: number;
  /** 10: when and how this student left, and on which computer */
  left?: LeftInfo;
  /** 09 and 08: what will go, and what was given and left alone */
  handIn?: { files: FileLine[]; unchanged: FileLine[] };
  handingIn: boolean;
  /** 02: the computer's checks, the apps that will be closed, and whether it is being locked now */
  checks?: { checks: Check[]; ok: boolean; toClose: AppToClose[]; locking: boolean; error?: string };
  /** the computer is locked for the exam (F-07) */
  locked: boolean;
  /** the exam is over here, but the computer couldn't be put back as it was — yet: ExamMode keeps trying */
  stillLocked?: string;
  /** 07: an app that isn't part of the exam was just closed */
  closed?: { name: string; at: number };
  /** the exam's apps, on the exam bar (05, 06): which are open, and which is in front */
  apps: BarApp[];
  /** an app of the exam that couldn't be opened on this computer */
  appMissing?: { name: string; at: number };
  receipt?: { code: string; files: { name: string; bytes: number }[]; at: number; byItself: boolean };
}

/** One of the exam's apps, as the exam bar shows it. */
export interface BarApp { id: string; name: string; badge?: { text: string; color: string }; running: boolean; front: boolean; /** a file of it that isn't saved (09) */ unsaved?: string }

/** What a teacher says about themselves when asking for a licence (F-44). */
export interface TeacherRequestForm { name: string; school: string; email: string; check: string; note?: string }
export type LicenceLoaded =
  | { ok: true; name: string; school: string; id: string }
  | { ok: false; why: 'invalid' | 'notFromAuthor' | 'withdrawn' | 'otherComputer' | 'unreadable' | 'noRequest' };

export interface StudentApi {
  get(): Promise<StudentState>;
  onState(listener: (state: StudentState) => void): () => void;
  pick(runId: string): Promise<void>;
  /** the teacher's computer name, typed in when no exam is found (F-01) */
  lookAt(host: string): Promise<void>;
  join(studentId: string, code: string): Promise<void>;
  /** 02: look at the computer again, after something was fixed */
  checkAgain(): Promise<void>;
  /** 02: close the apps that aren't part of the exam, and lock */
  lock(): Promise<void>;
  /** 02: Back */
  backOut(): Promise<void>;
  /** Hand in… : lists the files (09) */
  askHandIn(): Promise<void>;
  /** back to the exam from Hand in (09) or Leave (08) */
  keepWorking(): Promise<void>;
  handIn(): Promise<void>;
  /** ⋯ Leave the exam: asks first (08) */
  askLeave(): Promise<void>;
  /** Leave, confirmed (F-15) */
  leave(): Promise<void>;
  /** Close on *You can't join this exam again* (10): stop asking */
  giveUp(): Promise<void>;
  /** Finish (09b): back to how it was */
  finish(): Promise<void>;
  showQuestions(): Promise<void>;
  /** opens one of the exam's apps under the bar, or brings it to the front (F-11) */
  openApp(id: string): Promise<void>;
  openFolder(): Promise<void>;
  /** I'm a teacher… (F-44): the request to send to the author, as text — or what is missing, in words */
  teacherRequest(form: TeacherRequestForm): Promise<{ text: string; address: string; author: string } | { error: string }>;
  copyText(text: string): Promise<void>;
  /** opens the request in the computer's email app, when the author's address is known */
  emailRequest(text: string): Promise<void>;
  /** the licence file the author sent; nothing: no file was chosen */
  loadLicence(): Promise<LicenceLoaded | undefined>;
  /** starts ExamMode again: with a licence, in teacher mode */
  restart(): Promise<void>;
}
