/**
 * The development switches (`EXAMMODE_…`, architecture §2.14): for the tests and for trying ExamMode on one
 * computer. An installed ExamMode has none: on a lab computer anyone can set a variable in the account's
 * environment — and with one, rename the computer for the teacher, move the Exam folder, or point ExamMode at
 * another settings folder.
 */
import { app } from 'electron';

export const devEnv = (): NodeJS.ProcessEnv => (app.isPackaged ? {} : process.env);
