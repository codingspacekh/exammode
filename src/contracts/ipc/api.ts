/** `window.exammode` (architecture §2.2): the one way the screens reach the system, made by the preload script. */
import type { BrowserApi } from './browser';
import type { StudentApi } from './student';
import type { TeacherApi } from './teacher';

/** Which window a renderer is: every window shows the same renderer, with `?view=`. */
export const VIEWS = ['student', 'teacher', 'bar', 'browser'] as const;
export type View = (typeof VIEWS)[number];

/** `window.exammode`, set by the preload script. */
export interface ExamModeApi {
  platform: string;
  /** which window this is */
  view: View;
  student?: StudentApi;
  teacher?: TeacherApi;
  browser?: BrowserApi;
}
