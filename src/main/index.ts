import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { app, dialog, Menu } from 'electron';
import { fileLog, type Log } from '@infrastructure/log';
import { devEnv } from './shell/env';
import { runStudent } from './shell/student';
import { runTeacher } from './shell/teacher';
import { teacherLicence } from './shell/trust';
import { setOut } from './shell/windows';

/**
 * ExamMode starts here. One app for students and teachers (architecture D1): a teacher licence opens teacher
 * mode (F-44); otherwise this is a lab computer's ExamMode.
 */
setOut(fileURLToPath(new URL('.', import.meta.url)));

// Tests get their own settings folder, so they never touch a real one.
const env = devEnv();
if (env.EXAMMODE_USER_DATA) app.setPath('userData', env.EXAMMODE_USER_DATA);

// One copy at a time (architecture D10).
if (!app.requestSingleInstanceLock()) app.quit();

// Nothing that goes wrong is lost in silence: it is in the log file, and ExamMode goes on (a dialog in the middle
// of an exam would be a way out of it).
const log = (): Log => fileLog(join(app.getPath('userData'), 'exammode.log'));
process.on('unhandledRejection', (error) => log()('main', 'a failure nobody waited for', error));
process.on('uncaughtException', (error) => log()('main', 'an error nobody caught', error));

void app.whenReady().then(async () => {
  // a lab computer's ExamMode has no menu: nothing in it is for a student (the Mac keeps its own, for copy and
  // paste in the teacher's forms)
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  // F-44: this is a teacher's ExamMode when it has the author's licence for its own key. A development build
  // can also be told to be one, with no licence (`--teacher`); `--student` is a lab computer's whatever it has.
  const identity = await teacherLicence().identity();
  const asked = !app.isPackaged && (process.argv.includes('--teacher') || env.EXAMMODE_MODE === 'teacher');
  const teacher = !process.argv.includes('--student') && (identity !== undefined || asked);
  return teacher ? runTeacher(identity) : runStudent();
}).catch((error: unknown) => {
  // ExamMode couldn't start: said, written down, and closed — not left running with no window
  log()('main', 'ExamMode couldn\'t start', error);
  dialog.showErrorBox('ExamMode can\'t open', error instanceof Error ? error.message : String(error));
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
