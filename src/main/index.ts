import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { runStudent } from './shell/student';
import { runTeacher } from './shell/teacher';
import { setOut } from './shell/windows';

/**
 * ExamMode starts here. One app for students and teachers (architecture D1): `--teacher` opens teacher mode
 * (a licence takes its place in M7); otherwise this is a lab computer's ExamMode.
 */
setOut(fileURLToPath(new URL('.', import.meta.url)));

// Tests get their own settings folder, so they never touch a real one.
if (process.env.EXAMMODE_USER_DATA) app.setPath('userData', process.env.EXAMMODE_USER_DATA);

// One copy at a time (architecture D10).
if (!app.requestSingleInstanceLock()) app.quit();

const teacher = process.argv.includes('--teacher') || process.env.EXAMMODE_MODE === 'teacher';
void app.whenReady().then(() => (teacher ? runTeacher() : runStudent()));
app.on('window-all-closed', () => app.quit());
