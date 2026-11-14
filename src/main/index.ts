import { fileURLToPath } from 'node:url';
import { app } from 'electron';
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
if (process.env.EXAMMODE_USER_DATA) app.setPath('userData', process.env.EXAMMODE_USER_DATA);

// One copy at a time (architecture D10).
if (!app.requestSingleInstanceLock()) app.quit();

void app.whenReady().then(async () => {
  // F-44: this is a teacher's ExamMode when it has the author's licence for its own key. A development build
  // can also be told to be one, with no licence (`--teacher`); `--student` is a lab computer's whatever it has.
  const identity = await teacherLicence().identity();
  const asked = !app.isPackaged && (process.argv.includes('--teacher') || process.env.EXAMMODE_MODE === 'teacher');
  const teacher = !process.argv.includes('--student') && (identity !== undefined || asked);
  return teacher ? runTeacher(identity) : runStudent();
});
app.on('window-all-closed', () => app.quit());
