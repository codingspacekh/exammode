import { createSocket } from 'node:dgram';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * M3's journey (MILESTONES §6): a teacher and two students on one machine — join, start, a blocked page, hand in,
 * the receipts match. The built app, three times: once in teacher mode, twice as a lab computer. Nothing is
 * locked (that is M4).
 */
const apps: ElectronApplication[] = [];
const servers: Server[] = [];
let home: string;

test.beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'exammode-e2e-')); });
test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => undefined);
  for (const server of servers.splice(0)) server.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** A web server on this computer: the exam's question site, or a site that isn't part of the exam. */
async function site(pages: Record<string, string>): Promise<string> {
  const server = createServer((req, res) => {
    const page = pages[req.url ?? '/'];
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(page ?? 'Not here');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const freeUdpPort = (): Promise<number> => new Promise((resolve) => {
  const socket = createSocket('udp4');
  socket.bind(0, () => {
    const { port } = socket.address();
    socket.close(() => resolve(port));
  });
});
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function launch(name: string, env: Record<string, string>, ...args: string[]): Promise<ElectronApplication> {
  const app = await electron.launch({ args: ['out/main/index.js', ...args], env: { ...process.env, EXAMMODE_USER_DATA: join(home, name), ...env } as Record<string, string> });
  apps.push(app);
  return app;
}

/** One of an app's windows, by the screen it shows (`?view=`). */
async function windowOf(app: ElectronApplication, view: string): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes(`view=${view}`)), { timeout: 15_000 }).toBe(true);
  return app.windows().find((w) => w.url().includes(`view=${view}`))!;
}

/** Clicks a link in a page of the exam browser (its pages are views of the main process, not windows), as a
 *  student's own click: without that, the browser takes the new page as a redirect and keeps no way back. */
const clickLink = (app: ElectronApplication, text: string) => app.evaluate(async ({ webContents }, wanted) => {
  for (const contents of webContents.getAllWebContents()) {
    if (!/^http:\/\/127\.0\.0\.1/.test(contents.getURL())) continue;
    const clicked = await contents.executeJavaScript(`(() => { const a = [...document.links].find((l) => l.textContent === ${JSON.stringify(wanted)}); a?.click(); return !!a; })()`, true);
    if (clicked) return true;
  }
  return false;
}, text);

/** With EXAMMODE_SHOTS=<folder>, a picture of each screen is kept there, to compare with the prototype. */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.EXAMMODE_SHOTS) await page.screenshot({ path: join(process.env.EXAMMODE_SHOTS, `${name}.png`) });
}

async function joinAs(student: Page, name: string, code: string): Promise<void> {
  await student.getByRole('radio', { name: /Term 1 practical exam/ }).click();
  await student.getByRole('combobox', { name: 'Your name' }).click();
  await student.getByRole('option', { name }).click();
  await student.getByRole('textbox', { name: 'Exam code' }).fill(code);
  await shot(student, '01-join');
  await student.getByRole('button', { name: /^Join/ }).click();
  await expect(student.getByRole('heading', { name: 'You\'re in. Waiting for Ms Srey Leak to start.' })).toBeVisible();
}

test('a teacher and two students: join, start, a blocked page, hand in, the receipts match', async () => {
  test.setTimeout(120_000);
  const elsewhere = await site({ '/': '<title>Answers</title><h1>Every answer</h1>' });
  const questions = await site({
    '/questions.html': `<title>Term 1 practical — questions</title><h1>Practical exam</h1><a href="/notes.html">The notes</a> <a href="${elsewhere}/">Look it up</a>`,
    '/notes.html': '<title>Notes</title><h1>Notes</h1>',
  });
  const [port, beacon] = [await freePort(), await freeUdpPort()];
  const handIns = join(home, 'Hand-ins');
  // a file the teacher gives every student (F-33)
  const marks = join(home, 'marks.csv');
  writeFileSync(marks, 'name,mark\n');

  // ── the teacher opens the exam ────────────────────────────────────────────────────────────────────────────────
  const teacherApp = await launch('teacher', { EXAMMODE_PORT: String(port), EXAMMODE_BEACON_PORT: String(beacon), EXAMMODE_BEACON_TO: '127.0.0.1', EXAMMODE_HANDINS: handIns, EXAMMODE_EXPORT: join(home, 'Log.csv'), EXAMMODE_CHOOSE: marks }, '--teacher');
  const teacher = await windowOf(teacherApp, 'teacher');
  await expect(teacher).toHaveTitle('ExamMode');
  await teacher.getByRole('textbox', { name: 'Title' }).fill('Year 10 ICT — Term 1 practical exam');
  await teacher.getByRole('textbox', { name: 'Your name' }).fill('Ms Srey Leak');
  await teacher.getByRole('textbox', { name: 'The class\'s name' }).fill('Year 10 A');
  await teacher.getByRole('textbox', { name: /Students/ }).fill('Sokha Chan\nDara Kim\nVannak Sok');
  await teacher.getByRole('radio', { name: 'On a website' }).click();
  await teacher.getByRole('textbox', { name: 'The question page' }).fill(`${questions}/questions.html`);
  await teacher.getByRole('button', { name: 'Add a website' }).click();
  await teacher.getByRole('textbox', { name: 'Another website 1' }).fill(`${questions}/*`);
  await teacher.getByRole('button', { name: 'Add files' }).click();
  await expect(teacher.getByRole('list', { name: 'Files to give' })).toContainText('marks.csv');
  await shot(teacher, '11-make-exam');
  const open = teacher.getByRole('button', { name: 'Open for students…' });
  // the theme's accent (design/src/styles.css --accent)
  expect(await open.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(59, 79, 216)');
  await open.click();
  const code = (await teacher.getByLabel(/^Exam code \d/).textContent({ timeout: 30_000 }))!;
  expect(code).toMatch(/^\d{4}$/);

  // ── two lab computers join: one hears the beacon, the other is told the teacher's computer name ───────────────
  const lab = (pc: string, listen: number) => launch(pc, { EXAMMODE_PC: pc, EXAMMODE_PORT: String(port), EXAMMODE_BEACON_PORT: String(listen), EXAMMODE_EXAM_ROOT: join(home, pc, 'Exam') });
  const sokhaApp = await lab('PC-14', beacon);
  const sokha = await windowOf(sokhaApp, 'student');
  await joinAs(sokha, 'Sokha Chan', code);

  const daraApp = await lab('PC-03', await freeUdpPort());
  const dara = await windowOf(daraApp, 'student');
  await expect(dara.getByText('Looking for exams on the classroom network…')).toBeVisible();
  await dara.getByRole('button', { name: 'type your teacher\'s computer name' }).click();
  await dara.getByRole('textbox', { name: 'Your teacher\'s computer name' }).fill('127.0.0.1');
  await dara.getByRole('button', { name: 'Look there' }).click();
  // a wrong code first
  await dara.getByRole('radio', { name: /Term 1 practical exam/ }).click();
  await dara.getByRole('combobox', { name: 'Your name' }).click();
  await dara.getByRole('option', { name: 'Dara Kim' }).click();
  await dara.getByRole('textbox', { name: 'Exam code' }).fill(code === '0000' ? '1111' : '0000');
  await dara.getByRole('button', { name: /^Join/ }).click();
  await expect(dara.getByRole('alert')).toContainText('That isn\'t the code on the board');
  await joinAs(dara, 'Dara Kim', code);

  await expect(teacher.getByText('of 3 students')).toBeVisible();
  await expect(teacher.getByRole('row', { name: /Sokha Chan PC-14 .* Ready/ })).toBeVisible();
  await expect(teacher.getByRole('row', { name: /Dara Kim PC-03 .* Ready/ })).toBeVisible();
  await expect(teacher.getByText('1 student not here yet')).toBeVisible();
  await shot(teacher, '12-lobby');
  await shot(sokha, '03-waiting');

  // ── Start: the exam bar and the exam browser open on both ─────────────────────────────────────────────────────
  await teacher.getByRole('button', { name: 'Start the exam' }).click();
  await expect(teacher.getByRole('button', { name: 'Sokha Chan' })).toContainText('In the exam');
  const bar = await windowOf(sokhaApp, 'bar');
  await expect(bar.getByText('Sokha Chan · PC-14 · set by Ms Srey Leak')).toBeVisible();
  await expect(bar.getByRole('timer')).toHaveText(/^1:(29|30):\d\d$/);
  await expect(bar.getByRole('status')).toHaveText('Connected');
  const browser = await windowOf(sokhaApp, 'browser');
  await expect(browser.getByRole('tab', { name: 'Term 1 practical — questions' })).toBeVisible();
  await expect(browser.getByLabel('This page\'s address')).toContainText('/questions.html');
  await shot(bar, '04-exam-bar');
  await shot(browser, '04-exam-browser');

  // an allowed link opens; a link to another site doesn't, and the teacher gets a note (F-13)
  expect(await clickLink(sokhaApp, 'The notes')).toBe(true);
  await expect(browser.getByRole('tab', { name: 'Notes' })).toBeVisible();
  await browser.getByRole('button', { name: 'Back' }).click();
  await expect(browser.getByRole('tab', { name: 'Term 1 practical — questions' })).toBeVisible();
  expect(await clickLink(sokhaApp, 'Look it up')).toBe(true);
  await expect(browser.getByRole('heading', { name: 'This page isn\'t part of the exam' })).toBeVisible();
  await expect(teacher.getByRole('list', { name: 'What\'s happening' })).toContainText('Sokha Chan clicked a site that isn\'t allowed');
  await shot(browser, '07b-page-blocked');
  await shot(teacher, '13-live');
  await browser.getByRole('button', { name: 'Back to the questions' }).click();
  await expect(browser.getByRole('heading', { name: 'This page isn\'t part of the exam' })).toBeHidden();

  // ── Sokha works in the Exam folder and hands in ───────────────────────────────────────────────────────────────
  const examRoot = join(home, 'PC-14', 'Exam');
  const folder = join(examRoot, readdirSync(examRoot)[0]!, 'Sokha Chan');
  // the teacher's file is there, as it was given
  await expect.poll(() => readdirSync(folder)).toEqual(['marks.csv']);
  expect(readFileSync(join(folder, 'marks.csv'), 'utf8')).toBe('name,mark\n');
  writeFileSync(join(folder, 'Report.docx'), 'Sokha\'s report');
  await bar.getByRole('button', { name: 'Hand in…' }).click();
  await expect(sokha.getByRole('dialog', { name: 'Hand in your work' })).toBeVisible();
  await expect(sokha.getByRole('list', { name: 'Your work' })).toContainText('Report.docx');
  // a given file that wasn't changed is listed apart, and isn't handed in
  await expect(sokha.getByRole('list', { name: 'Your work' })).toContainText('Given by Ms Srey Leak, not changed');
  await shot(sokha, '09-hand-in');
  await sokha.getByRole('button', { name: 'Hand in now' }).click();
  await expect(sokha.getByRole('heading', { name: 'Handed in' })).toBeVisible();
  await shot(sokha, '09b-handed-in');
  const receipt = (await sokha.locator('dd .font-mono').textContent())!;
  expect(receipt).toMatch(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/);
  await expect(teacher.getByRole('button', { name: 'Sokha Chan' })).toContainText(`1 file · ${receipt}`);
  const run = readdirSync(handIns).find((name) => !name.startsWith('.'))!;
  expect(readFileSync(join(handIns, run, 'Sokha Chan', 'Report.docx'), 'utf8')).toBe('Sokha\'s report');
  // the exam bar and the browser are gone from Sokha's computer
  await expect.poll(() => sokhaApp.windows().filter((w) => /view=(bar|browser)/.test(w.url())).length).toBe(0);

  // ── Dara leaves, asks to come back, and the teacher lets her back in (F-15, F-18, F-40) ────────────────────────
  const daraRoot = join(home, 'PC-03', 'Exam');
  const daraFolder = join(daraRoot, readdirSync(daraRoot)[0]!, 'Dara Kim');
  writeFileSync(join(daraFolder, 'sales.xlsx'), 'numbers');
  const daraBar = await windowOf(daraApp, 'bar');
  await daraBar.getByRole('button', { name: 'Leave the exam…' }).click();
  const leave = dara.getByRole('button', { name: 'Leave the exam' });
  await expect(leave).toBeDisabled();
  await shot(dara, '08-leave');
  await dara.getByRole('checkbox', { name: /I understand/ }).click();
  await leave.click();
  await expect(dara.getByRole('heading', { name: 'Join your exam' })).toBeVisible();
  await expect(teacher.getByRole('button', { name: 'Dara Kim' })).toContainText('Left');
  expect(readFileSync(join(handIns, run, 'Dara Kim', 'sales.xlsx'), 'utf8')).toBe('numbers');

  await dara.getByRole('radio', { name: /Term 1 practical exam/ }).click();
  await dara.getByRole('combobox', { name: 'Your name' }).click();
  await dara.getByRole('option', { name: 'Dara Kim' }).click();
  await dara.getByRole('textbox', { name: 'Exam code' }).fill(code);
  await dara.getByRole('button', { name: /^Join/ }).click();
  await expect(dara.getByRole('heading', { name: 'You can\'t join this exam again' })).toBeVisible();
  await expect(dara.getByText('You pressed Leave')).toBeVisible();
  await shot(dara, '10-cant-join');

  await teacher.getByRole('button', { name: 'Look' }).click();
  const panel = teacher.getByRole('region', { name: 'Dara Kim' });
  await expect(panel.getByRole('list', { name: 'Timeline' })).toContainText('Asked to come back in on PC-03');
  await shot(teacher, '13b-student');
  await panel.getByRole('combobox', { name: 'Reason (for the log)' }).click();
  await teacher.getByRole('option', { name: 'Pressed Leave by mistake' }).click();
  await panel.getByRole('button', { name: 'Let back in' }).click();
  // the exam opens on her computer by itself
  await expect.poll(() => daraApp.windows().some((w) => w.url().includes('view=bar')), { timeout: 15_000 }).toBe(true);
  await expect(teacher.getByRole('button', { name: 'Dara Kim', exact: true })).toContainText('In the exam');
  await expect(panel.getByRole('list', { name: 'Timeline' })).toContainText('You let them back inReason: Pressed Leave by mistake');
  await panel.getByRole('button', { name: '10 min' }).click();
  await expect((await windowOf(daraApp, 'bar')).getByRole('timer')).toHaveText(/^1:3\d:\d\d$/);

  // ── the teacher ends the exam: Dara's work is handed in by itself ─────────────────────────────────────────────
  writeFileSync(join(daraFolder, 'sales.xlsx'), 'more numbers');
  await teacher.getByRole('button', { name: 'End the exam…' }).click();
  await teacher.getByRole('button', { name: 'End the exam', exact: true }).click();
  await expect(dara.getByRole('heading', { name: 'Handed in' })).toBeVisible();
  await expect(dara.getByText(/by itself when the exam ended/)).toBeVisible();
  const daraReceipt = (await dara.locator('dd .font-mono').textContent())!;
  expect(daraReceipt).not.toBe(receipt);

  // ── 14 After the exam: every hand-in with its receipt; the log as a spreadsheet ───────────────────────────────
  await expect(teacher.getByRole('heading', { name: 'Hand-ins' })).toBeVisible();
  await expect(teacher.getByText(/Ended \d\d:\d\d/)).toBeVisible();
  await expect(teacher.getByRole('row', { name: /Sokha Chan PC-14 .*Handed in .* Pressed Hand in Report\.docx/ })).toContainText(receipt);
  await expect(teacher.getByRole('row', { name: /Dara Kim PC-03 .*Ended .* sales\.xlsx/ })).toContainText(daraReceipt);
  await expect(teacher.getByRole('row', { name: /Vannak Sok/ })).toContainText('Didn\'t join');
  expect(readFileSync(join(handIns, run, 'Dara Kim', 'sales.xlsx'), 'utf8')).toBe('more numbers');
  await shot(teacher, '14-after');
  await teacher.getByRole('button', { name: 'Export the log (CSV)' }).click();
  await expect(teacher.getByRole('status')).toContainText('Log.csv');
  const log = readFileSync(join(home, 'Log.csv'), 'utf8');
  expect(log).toContain('Dara Kim,PC-03,letBackIn,reason: Pressed Leave by mistake');
  expect(log).toContain('Sokha Chan,PC-14,pageBlocked');

  // ── Done: the exam is kept, with its class, to open again next time (F-35, F-43) ──────────────────────────────
  await teacher.getByRole('button', { name: 'Done' }).click();
  await expect(teacher.getByRole('row', { name: /Year 10 ICT — Term 1 practical exam Year 10 A 1 h 30 min 2 websites 1 .* run once/ })).toBeVisible();
  await shot(teacher, '11-exams');
  await teacher.getByRole('button', { name: 'Classes' }).click();
  await expect(teacher.getByRole('textbox', { name: 'Students' })).toHaveValue('Dara Kim\nSokha Chan\nVannak Sok');
  await shot(teacher, '11-classes');

  // Finish: ExamMode is as it was
  await sokha.getByRole('button', { name: 'Finish' }).click();
  await expect(sokha.getByRole('heading', { name: 'Join your exam' })).toBeVisible();
});
