/**
 * The IPC contract (architecture §2.2): each side's calls by name, and the channels they travel on — one list, used
 * by the preload script (which makes `window.exammode`) and by the main process (which answers). A call added to an
 * API and forgotten in a list, or answered with the wrong type, doesn't compile.
 */
import type { BrowserApi } from './browser';
import type { StudentApi } from './student';
import type { TeacherApi } from './teacher';

/** The three sides a screen can talk to. */
export const SIDES = ['student', 'teacher', 'browser'] as const;
export type Side = (typeof SIDES)[number];
export interface ApiOf { student: StudentApi; teacher: TeacherApi; browser: BrowserApi }

/** An API's calls: everything but the state and its listener. */
export type CallsOf<Api> = Exclude<keyof Api, 'get' | 'onState'>;
/** The main process's answer to each call of an API: the same arguments, and the API's own answer (or its promise's). */
export type Handlers<Api> = {
  [K in CallsOf<Api>]: Api[K] extends (...args: infer A) => infer R ? (...args: A) => R | Awaited<R> : never;
};
/** What a side's state is. */
export type StateOf<Api> = Api extends { get(): Promise<infer S> } ? S : never;

export const STUDENT_CALLS = ['pick', 'lookAt', 'join', 'checkAgain', 'lock', 'backOut', 'askHandIn', 'keepWorking', 'handIn', 'askLeave', 'leave', 'giveUp', 'finish', 'showQuestions', 'openApp', 'openFolder', 'teacherRequest', 'copyText', 'emailRequest', 'loadLicence', 'restart'] as const satisfies readonly CallsOf<StudentApi>[];
export const TEACHER_CALLS = ['open', 'saveExam', 'openSaved', 'copyExam', 'deleteExam', 'chooseFiles', 'saveClass', 'deleteClass', 'readListFile', 'start', 'end', 'letBackIn', 'keepOut', 'addTime', 'done', 'openFolder', 'exportLog'] as const satisfies readonly CallsOf<TeacherApi>[];
export const BROWSER_CALLS = ['select', 'close', 'back', 'forward', 'reload', 'toQuestions'] as const satisfies readonly CallsOf<BrowserApi>[];
export const CALLS = { student: STUDENT_CALLS, teacher: TEACHER_CALLS, browser: BROWSER_CALLS } as const satisfies { [S in Side]: readonly CallsOf<ApiOf[S]>[] };

/** Every call of the API is on its list (a missing one is named in the error). */
type Listed<Api, List extends readonly string[]> = Exclude<CallsOf<Api>, List[number]> extends never ? true : { missing: Exclude<CallsOf<Api>, List[number]> };
export const ALL_LISTED: [Listed<StudentApi, typeof STUDENT_CALLS>, Listed<TeacherApi, typeof TEACHER_CALLS>, Listed<BrowserApi, typeof BROWSER_CALLS>] = [true, true, true];

/** The channels: `side:get` answers the state, `side:state` pushes it, `side:call` answers a call. */
export const channel = {
  get: (side: Side): string => `${side}:get`,
  state: (side: Side): string => `${side}:state`,
  call: (side: Side, call: string): string => `${side}:${call}`,
};
