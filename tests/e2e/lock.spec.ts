import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * M4's journey, on real Windows only (GitHub's Windows computers, as administrator; a lab computer at the gate):
 * the built ExamMode and the built Guard lock this computer for an exam and put it back.
 * A student joins, the computer is checked and locked; Notepad is closed when it is started; after the hand-in
 * and Finish everything is as it was. Then: ExamMode is killed, and the Guard tells the teacher and unlocks.
 */
test.skip(process.platform !== 'win32', 'the lock is Windows only');

const electronExe = createRequire(import.meta.url)('electron') as unknown as string;
const apps: ElectronApplication[] = [];
let guard: ChildProcess | undefined;
let home: string;

const out = (file: string, args: string[]): string => {
  try {
    return execFileSync(file, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? '');
  }
};
const explorerRuns = (): boolean => /explorer\.exe/i.test(out('tasklist.exe', ['/fi', 'imagename eq explorer.exe', '/nh']));
const CHARMAP = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\charmap.exe`;
const charmapRuns = (): boolean => /charmap\.exe/i.test(out('tasklist.exe', ['/fi', 'imagename eq charmap.exe', '/nh']));
const notepadRuns = (): boolean => /notepad\.exe/i.test(out('tasklist.exe', ['/fi', 'imagename eq notepad.exe', '/nh']));
/** Can a program that isn't ExamMode reach the internet? */
const curlReaches = (): boolean => /^[23]\d\d$/.test(out('curl.exe', ['-s', '-m', '8', '-o', 'NUL', '-w', '%{http_code}', 'https://example.com']).trim());
/** Where the space for apps starts, from the top of the screen, as Windows itself says. */
const workAreaTop = (): number => Number(out('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Y']).trim());
const taskManagerOff = (): boolean => /DisableTaskMgr\s+REG_DWORD\s+0x1/.test(out('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', '/v', 'DisableTaskMgr']));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** The Guard, as its own program. Answers when it says it is ready. */
function startGuard(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['out/guard/main.js', '--allow', electronExe, '--port', String(port), '--journal', join(home, 'journal.json'), '--no-relaunch'], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`The Guard stopped (${code})`)));
    child.stdout!.on('data', (text: Buffer) => {
      process.stdout.write(`[guard] ${text}`);
      if (String(text).includes('is ready')) resolve(child);
    });
  });
}

async function launch(name: string, env: Record<string, string>, ...args: string[]): Promise<ElectronApplication> {
  const app = await electron.launch({ args: ['out/main/index.js', ...args], env: { ...process.env, EXAMMODE_USER_DATA: join(home, name), ...env } as Record<string, string> });
  apps.push(app);
  return app;
}
async function windowOf(app: ElectronApplication, view: string): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes(`view=${view}`)), { timeout: 20_000 }).toBe(true);
  return app.windows().find((w) => w.url().includes(`view=${view}`))!;
}

test.beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'exammode-lock-')); });
test.afterEach(async () => {
  // ExamMode gone, the Guard's watchdog puts the computer back; then the Guard itself can go
  for (const app of apps.splice(0)) await app.close().catch(() => undefined);
  const journal = join(home, 'journal.json');
  for (let i = 0; i < 120 && existsSync(journal); i++) await new Promise((r) => setTimeout(r, 500));
  guard?.kill();
  guard = undefined;
  if (!explorerRuns()) spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
  out('taskkill.exe', ['/f', '/im', 'charmap.exe']);
  rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** A teacher with an open exam, a Guard, and a lab computer's ExamMode that will lock. */
async function classroom() {
  const [port, guardPort] = [await freePort(), await freePort()];
  guard = await startGuard(guardPort);
  const teacherApp = await launch('teacher', { EXAMMODE_PORT: String(port), EXAMMODE_BEACON_PORT: '47991', EXAMMODE_BEACON_TO: '127.0.0.1', EXAMMODE_HANDINS: join(home, 'Hand-ins') }, '--teacher');
  const teacher = await windowOf(teacherApp, 'teacher');
  await teacher.getByRole('textbox', { name: 'Title' }).fill('Term 1 practical exam');
  await teacher.getByRole('textbox', { name: 'Your name' }).fill('Ms Srey Leak');
  await teacher.getByRole('textbox', { name: 'The class\'s name' }).fill('Year 10 A');
  await teacher.getByRole('textbox', { name: /Students/ }).fill('Sokha Chan\nDara Kim');
  // F-31 one app for this exam, by its program's place: Character Map, which every Windows has
  await teacher.getByRole('textbox', { name: /Another app/ }).fill(CHARMAP);
  await teacher.getByRole('button', { name: 'Add the app' }).click();
  await teacher.getByRole('button', { name: 'Open for students…' }).click();
  const code = (await teacher.getByLabel(/^Exam code \d/).textContent({ timeout: 30_000 }))!;

  const studentApp = await launch('PC-14', {
    EXAMMODE_PC: 'PC-14', EXAMMODE_PORT: String(port), EXAMMODE_BEACON_PORT: '47991', EXAMMODE_EXAM_ROOT: join(home, 'Exam'),
    // a development build that locks: GitHub's computers are virtual machines, their own agent has a window and
    // has to stay reachable, and the Guard is Node running out/guard/main.js
    EXAMMODE_LOCK: '1', EXAMMODE_ALLOW_VM: '1', EXAMMODE_ALLOW_RUNNING: '1', EXAMMODE_KEEP_REACHABLE: 'Runner.', EXAMMODE_GUARD_PORT: String(guardPort), EXAMMODE_GUARD_EXE: process.execPath,
  });
  const student = await windowOf(studentApp, 'student');
  await student.getByRole('radio', { name: /Term 1 practical exam/ }).click({ timeout: 30_000 });
  await student.getByRole('combobox', { name: 'Your name' }).click();
  await student.getByRole('option', { name: 'Sokha Chan' }).click();
  await student.getByRole('textbox', { name: 'Exam code' }).fill(code);
  await student.getByRole('button', { name: /^Join/ }).click();

  // 02: the checks pass (a virtual machine is allowed here), and nothing is locked yet
  await expect(student.getByRole('heading', { name: 'Getting this computer ready' })).toBeVisible();
  await expect(student.getByRole('list', { name: 'Checks' })).toContainText('The clipboard is emptied', { timeout: 60_000 });
  await expect(student.getByRole('list', { name: 'Checks' })).toContainText('One screen');
  expect(explorerRuns()).toBe(true);
  await student.getByRole('button', { name: /continue/i }).click();
  await expect(student.getByRole('heading', { name: /Waiting for Ms Srey Leak/ })).toBeVisible({ timeout: 60_000 });
  await expect(teacher.getByRole('row', { name: /Sokha Chan PC-14 .* Ready/ })).toBeVisible();
  return { teacher, student, studentApp, teacherApp };
}

test('F-07 F-12 F-21 F-23 a lab computer is locked for the exam, closes an app that isn\'t part of it, and is put back after the hand-in', async () => {
  test.setTimeout(6 * 60_000);
  expect(curlReaches()).toBe(true);
  const { teacher, student, studentApp } = await classroom();

  // locked: no taskbar or desktop, no Task Manager, and no program but ExamMode reaches the internet
  expect(explorerRuns()).toBe(false);
  expect(taskManagerOff()).toBe(true);
  expect(curlReaches()).toBe(false);
  expect(existsSync(join(home, 'journal.json'))).toBe(true);
  // F-07 ExamMode fills the screen
  expect(await studentApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isKiosk()))).toBe(true);

  await teacher.getByRole('button', { name: 'Start the exam' }).click();
  const bar = await windowOf(studentApp, 'bar');
  await expect(bar.getByText('Sokha Chan · PC-14 · set by Ms Srey Leak')).toBeVisible();
  // D6 the bar holds the top of the screen: the work area starts under it
  await expect.poll(workAreaTop, { timeout: 20_000 }).toBeGreaterThanOrEqual(50);

  // F-11 the exam's app is on the bar: pressed, it opens and may stay; the teacher's card says it is in front
  await bar.getByRole('button', { name: /charmap/i }).click();
  await expect.poll(charmapRuns, { timeout: 20_000 }).toBe(true);
  await expect(bar.getByRole('button', { name: /charmap/i }).getByRole('img', { name: 'open' })).toBeVisible({ timeout: 15_000 });
  await expect(teacher.getByRole('button', { name: 'Sokha Chan' })).toContainText(/charmap/i, { timeout: 15_000 });

  // F-12 Notepad is started: closed, said on the bar, and a warning on the teacher's card
  spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref();
  await expect(teacher.getByRole('list', { name: 'What\'s happening' })).toContainText(/Sokha Chan opened notepad — closed/i, { timeout: 30_000 });
  await expect(bar.getByRole('alert')).toContainText(/notepad isn't part of this exam/i);
  await expect(teacher.getByRole('button', { name: 'Sokha Chan' })).toContainText('Warning');
  await expect.poll(notepadRuns, { timeout: 10_000 }).toBe(false);
  // … while the exam's own app is still there
  expect(charmapRuns()).toBe(true);

  // the work is handed in; Finish puts the computer back
  const root = join(home, 'Exam');
  writeFileSync(join(root, readdirSync(root)[0]!, 'Sokha Chan', 'Report.docx'), 'written while locked');
  await bar.getByRole('button', { name: 'Hand in…' }).click();
  await student.getByRole('button', { name: 'Hand in now' }).click();
  await expect(student.getByRole('heading', { name: 'Handed in' })).toBeVisible({ timeout: 30_000 });
  expect(explorerRuns()).toBe(false);
  await student.getByRole('button', { name: 'Finish' }).click();
  await expect(student.getByRole('heading', { name: 'Join your exam' })).toBeVisible();

  await expect.poll(() => existsSync(join(home, 'journal.json')), { timeout: 60_000 }).toBe(false);
  await expect.poll(explorerRuns, { timeout: 30_000 }).toBe(true);
  expect(taskManagerOff()).toBe(false);
  // the exam's apps were closed with the exam
  expect(charmapRuns()).toBe(false);
  await expect.poll(curlReaches, { timeout: 30_000 }).toBe(true);
  expect(await studentApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isKiosk()))).toBe(false);
  // the top of the screen was given back
  expect(workAreaTop()).toBe(0);
  const handIns = join(home, 'Hand-ins');
  const run = readdirSync(handIns).find((name) => !name.startsWith('.'))!;
  expect(readFileSync(join(handIns, run, 'Sokha Chan', 'Report.docx'), 'utf8')).toBe('written while locked');
});

test('F-20 N-04 ExamMode is killed during the exam: the teacher sees stopped suddenly, and the computer is back to normal', async () => {
  test.setTimeout(6 * 60_000);
  const { teacher, studentApp } = await classroom();
  await teacher.getByRole('button', { name: 'Start the exam' }).click();
  await expect(teacher.getByRole('button', { name: 'Sokha Chan' })).toContainText('In the exam');
  expect(explorerRuns()).toBe(false);

  // from an administrator's prompt: the whole of ExamMode, at once
  const pid = studentApp.process().pid!;
  out('taskkill.exe', ['/f', '/t', '/pid', String(pid)]);

  await expect(teacher.getByRole('list', { name: 'What\'s happening' })).toContainText('Sokha Chan left — ExamMode stopped suddenly on PC-14', { timeout: 30_000 });
  await expect(teacher.getByRole('button', { name: 'Sokha Chan' })).toContainText('Left');
  await expect.poll(() => existsSync(join(home, 'journal.json')), { timeout: 60_000 }).toBe(false);
  await expect.poll(explorerRuns, { timeout: 30_000 }).toBe(true);
  expect(taskManagerOff()).toBe(false);
  await expect.poll(curlReaches, { timeout: 30_000 }).toBe(true);
});
