/**
 * ExamMode in teacher mode: one window (11 minimal, 12, 13) showing the teacher's desk (desk.ts). Electron glue:
 * proven by the e2e tests.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import type { ExamForm } from '@lib/app/state';
import { hostOf } from '@lib/browser/sites';
import { TeacherDesk } from '../teacher/desk';
import { createWindow, serve } from './windows';

const number = (text: string | undefined): number | undefined => (text ? Number(text) : undefined);

/** Opens a website once, unseen, and answers with the other hosts its pages load their files from (§2.6). */
async function recordHosts(start: string): Promise<string[]> {
  const hosts = new Set<string>();
  const win = new BrowserWindow({ show: false, webPreferences: { partition: `record-${Date.now()}`, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, answer) => {
    if (/^https?:/.test(details.url)) hosts.add(hostOf(details.url));
    answer({});
  });
  try {
    await Promise.race([win.loadURL(start), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('too slow')), 10_000))]);
    // what the page fetches just after it has loaded
    await new Promise((r) => setTimeout(r, 1500));
  } catch {
    // what was seen until then is still worth keeping
  } finally {
    win.destroy();
  }
  hosts.delete(hostOf(start));
  return [...hosts];
}

export async function runTeacher(): Promise<void> {
  const env = process.env;
  const handIns = env.EXAMMODE_HANDINS ?? join(app.getPath('documents'), 'ExamMode Hand-ins');
  mkdirSync(handIns, { recursive: true });
  let desk: TeacherDesk;
  try {
    desk = await TeacherDesk.open({
      db: join(app.getPath('userData'), 'exammode.db'), handIns, port: number(env.EXAMMODE_PORT),
      beacon: { port: number(env.EXAMMODE_BEACON_PORT), targets: env.EXAMMODE_BEACON_TO ? () => env.EXAMMODE_BEACON_TO!.split(',') : undefined },
      record: recordHosts,
    });
  } catch (error) {
    const busy = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
    dialog.showErrorBox('ExamMode can\'t open', busy ? 'Another ExamMode in teacher mode is already running on this computer.' : String(error));
    return app.quit();
  }

  const win = createWindow('teacher', { width: 1440, height: 900, minWidth: 1280, minHeight: 720 });
  win.once('ready-to-show', () => win.show());
  const tell = serve('teacher', () => desk.state(), {
    open: (form: ExamForm) => desk.openExam(form),
    saveExam: async (form: ExamForm) => {
      const saved = await desk.saveExam(form);
      return 'error' in saved ? saved.error : undefined;
    },
    openSaved: (examId: string) => desk.openSaved(examId),
    copyExam: (examId: string) => desk.copyExam(examId),
    deleteExam: (examId: string) => desk.deleteExam(examId),
    // (tests say which files; a teacher is asked)
    chooseFiles: async () => {
      const paths = env.EXAMMODE_CHOOSE?.split(',') ?? (await dialog.showOpenDialog(win, { title: 'Files to give every student', properties: ['openFile', 'multiSelections'] })).filePaths;
      return paths.map((path) => ({ name: basename(path), bytes: statSync(path).size, path }));
    },
    saveClass: (change: { id?: string; name: string; list: string }) => desk.saveClass(change),
    deleteClass: (classId: string) => desk.deleteClass(classId),
    readListFile: async () => {
      const [path] = env.EXAMMODE_LIST_FILE ? [env.EXAMMODE_LIST_FILE] : (await dialog.showOpenDialog(win, { title: 'A class list', properties: ['openFile'], filters: [{ name: 'Spreadsheet or text (CSV, TXT)', extensions: ['csv', 'tsv', 'txt'] }] })).filePaths;
      return path ? readFileSync(path, 'utf8') : undefined;
    },
    start: () => desk.start(),
    end: () => desk.end(),
    letBackIn: (studentId: string, reason: string) => desk.letBackIn(studentId, reason),
    keepOut: (studentId: string, reason: string) => desk.keepOut(studentId, reason),
    addTime: (minutes: number, studentId?: string) => desk.addTime(minutes, studentId),
    done: () => desk.done(),
    openFolder: (studentId?: string) => {
      const folder = (studentId ? desk.folderOf(studentId) : desk.folder) ?? handIns;
      mkdirSync(folder, { recursive: true });
      return shell.openPath(folder);
    },
    exportLog: async () => {
      // (tests say where; a teacher is asked)
      const path = env.EXAMMODE_EXPORT ?? (await dialog.showSaveDialog(win, { title: 'Export the log', defaultPath: join(desk.folder ?? handIns, 'Log.csv'), filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }] })).filePath;
      if (!path) return undefined;
      writeFileSync(path, desk.logCsv());
      return path;
    },
  }, () => [win]);
  desk.onState(tell);
  app.on('before-quit', () => void desk.close());
}
