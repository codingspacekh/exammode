/**
 * What each side's screens can ask the main process for, by name (architecture §2.2): one list, used by the
 * preload script (which makes `window.exammode`) and checked against the API's shape and the main process's
 * handlers — a call added to one and forgotten in another doesn't compile.
 */
import type { BrowserApi, StudentApi, TeacherApi } from './state';

/** An API's calls: everything but the state and its listener. */
export type CallsOf<Api> = Exclude<keyof Api, 'get' | 'onState'>;
/** The main process's answer to each call of an API. */
export type Handlers<Api> = { [K in CallsOf<Api>]: Api[K] extends (...args: infer A) => unknown ? (...args: A) => unknown : never };

export const STUDENT_CALLS = ['pick', 'lookAt', 'join', 'checkAgain', 'lock', 'backOut', 'askHandIn', 'keepWorking', 'handIn', 'askLeave', 'leave', 'giveUp', 'finish', 'showQuestions', 'openApp', 'openFolder', 'teacherRequest', 'copyText', 'emailRequest', 'loadLicence', 'restart'] as const satisfies readonly CallsOf<StudentApi>[];
export const TEACHER_CALLS = ['open', 'saveExam', 'openSaved', 'copyExam', 'deleteExam', 'chooseFiles', 'saveClass', 'deleteClass', 'readListFile', 'start', 'end', 'letBackIn', 'keepOut', 'addTime', 'done', 'openFolder', 'exportLog'] as const satisfies readonly CallsOf<TeacherApi>[];
export const BROWSER_CALLS = ['select', 'close', 'back', 'forward', 'reload', 'toQuestions'] as const satisfies readonly CallsOf<BrowserApi>[];

/** Every call of the API is on its list (a missing one is named in the error). */
type Listed<Api, List extends readonly string[]> = Exclude<CallsOf<Api>, List[number]> extends never ? true : { missing: Exclude<CallsOf<Api>, List[number]> };
export const ALL_LISTED: [Listed<StudentApi, typeof STUDENT_CALLS>, Listed<TeacherApi, typeof TEACHER_CALLS>, Listed<BrowserApi, typeof BROWSER_CALLS>] = [true, true, true];
