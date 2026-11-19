import { createSocket } from 'node:dgram';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { newKeyPair } from '@infrastructure/crypto/keys';
import { issue } from '@infrastructure/crypto/licence';
import { parseRequest } from '@domain/trust/licence';

/**
 * M7's gate (MILESTONES §6): a teacher asks for a licence and runs an exam with it. The built app: first as it is
 * on any computer; then, with the licence the author sent, as the teacher's; and a lab computer that believes only
 * the author's licences — as an installed ExamMode does — finds that teacher's exam and not an unlicensed one's.
 */
const apps: ElectronApplication[] = [];
let home: string;

test.beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'exammode-licence-')); });
test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => undefined);
  rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

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
async function windowOf(app: ElectronApplication, view: string): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes(`view=${view}`)), { timeout: 15_000 }).toBe(true);
  return app.windows().find((w) => w.url().includes(`view=${view}`))!;
}
async function makeExam(teacher: Page, title: string): Promise<string> {
  await teacher.getByRole('textbox', { name: 'Title' }).fill(title);
  await teacher.getByRole('textbox', { name: 'Your name' }).fill('Ms Srey Leak');
  await teacher.getByRole('textbox', { name: 'The class\'s name' }).fill('Year 10 A');
  await teacher.getByRole('textbox', { name: /Students/ }).fill('Sokha Chan\nDara Kim');
  await teacher.getByRole('button', { name: 'Open for students…' }).click();
  return (await teacher.getByLabel(/^Exam code \d/).textContent({ timeout: 30_000 }))!;
}

test('F-44 a teacher asks for a licence, loads it, and runs an exam only their students\' computers trust', async () => {
  const author = newKeyPair();
  const licenceFile = join(home, 'Srey Leak.emlicence');
  const port = await freePort();
  const beacon = await freeUdpPort();
  // every ExamMode here believes this test's author, and — like an installed one — no teacher without a licence
  const strict = { EXAMMODE_AUTHOR_KEYS: author.publicKey, EXAMMODE_REQUIRE_LICENCE: '1' };
  const laptop = { ...strict, EXAMMODE_PORT: String(port), EXAMMODE_BEACON_PORT: String(beacon), EXAMMODE_BEACON_TO: '127.0.0.1', EXAMMODE_HANDINS: join(home, 'Hand-ins'), EXAMMODE_LICENCE_FILE: licenceFile };

  // ── the teacher's laptop, before: ExamMode as on any computer ───────────────────────────────────────────────
  let app = await launch('teacher', { ...laptop, EXAMMODE_BEACON_PORT: String(await freeUdpPort()) });
  let page = await windowOf(app, 'student');
  await page.getByRole('button', { name: 'I\'m a teacher…' }).click();
  const ask = page.getByRole('dialog', { name: 'Ask for teacher mode' });
  // a licence file before asking: not a teacher's computer yet
  await ask.getByRole('textbox', { name: 'Your name' }).fill('Srey Leak');
  await ask.getByRole('button', { name: 'Make my request' }).click();
  await expect(ask.getByText('Type your school\'s name.')).toBeVisible();
  await ask.getByRole('textbox', { name: 'School', exact: true }).fill('Riverside High School');
  await ask.getByRole('textbox', { name: 'School email' }).fill('sreyleak@riverside-high.example');
  await ask.getByRole('textbox', { name: /Where it can be checked/ }).fill('riverside-high.example/staff');
  await ask.getByRole('button', { name: 'Make my request' }).click();
  const send = page.getByRole('dialog', { name: 'Send your request by email' });
  const text = (await send.getByLabel('Your request').textContent())!;
  expect(text).toContain('ExamMode teacher request');

  // ── the author: reads the email, checks the teacher, signs (`npm run licence`) ──────────────────────────────
  const request = parseRequest(text)!;
  expect(request).toMatchObject({ name: 'Srey Leak', school: 'Riverside High School', email: 'sreyleak@riverside-high.example' });
  // first a licence made by someone who isn't the author: refused
  writeFileSync(licenceFile, JSON.stringify(issue(request, '0001', Date.now(), newKeyPair().privateKey)));
  await send.getByRole('button', { name: 'I have a licence file…' }).click();
  await expect(send.getByText(/wasn't made by the author of this ExamMode/)).toBeVisible();
  // then the author's, for another computer's key: refused
  writeFileSync(licenceFile, JSON.stringify(issue({ ...request, key: newKeyPair().publicKey }, '0001', Date.now(), author.privateKey)));
  await send.getByRole('button', { name: 'I have a licence file…' }).click();
  await expect(send.getByText('This licence is for another computer. Ask for teacher mode from this one.')).toBeVisible();
  // then the real one
  writeFileSync(licenceFile, JSON.stringify(issue(request, '0042', Date.now(), author.privateKey)));
  await send.getByRole('button', { name: 'I have a licence file…' }).click();
  await expect(page.getByRole('dialog', { name: 'Teacher mode is on' })).toContainText('Srey Leak · Riverside High School · licence 0042');
  if (process.env.EXAMMODE_SHOTS) await page.screenshot({ path: join(process.env.EXAMMODE_SHOTS, 'm7-teacher-mode-on.png') });
  await app.close();

  // ── started again: it is the teacher's ExamMode ─────────────────────────────────────────────────────────────
  app = await launch('teacher', laptop);
  page = await windowOf(app, 'teacher');
  await expect(page.getByText(/Licensed to/)).toContainText('Licensed to Srey Leak · Riverside High School · licence 0042');
  const code = await makeExam(page, 'Term 1 practical exam');

  // an unlicensed laptop opens an exam too, and tells the same lab computer
  const fake = await launch('fake', { EXAMMODE_PORT: String(await freePort()), EXAMMODE_BEACON_PORT: String(beacon), EXAMMODE_BEACON_TO: '127.0.0.1', EXAMMODE_HANDINS: join(home, 'Fake hand-ins') }, '--teacher');
  const fakePage = await windowOf(fake, 'teacher');
  await expect(fakePage.getByText(/No teacher licence/)).toBeVisible();
  await makeExam(fakePage, 'Term 1 practical exam (not the teacher\'s)');

  // ── a lab computer: only the licensed teacher's exam is there ───────────────────────────────────────────────
  const lab = await launch('PC-14', { ...strict, EXAMMODE_PC: 'PC-14', EXAMMODE_PORT: String(port), EXAMMODE_BEACON_PORT: String(beacon), EXAMMODE_EXAM_ROOT: join(home, 'Exam') });
  const student = await windowOf(lab, 'student');
  await expect(student.getByRole('radio', { name: /Term 1 practical exam/ })).toBeVisible({ timeout: 15_000 });
  // (the other laptop has been announcing for as long)
  await student.waitForTimeout(2500);
  await expect(student.getByRole('radio')).toHaveCount(1);
  await expect(student.getByText(/not the teacher's/)).toHaveCount(0);

  await student.getByRole('radio', { name: /Term 1 practical exam/ }).click();
  await student.getByRole('combobox', { name: 'Your name' }).click();
  await student.getByRole('option', { name: 'Sokha Chan' }).click();
  await student.getByRole('textbox', { name: 'Exam code' }).fill(code);
  await student.getByRole('button', { name: /^Join/ }).click();
  await expect(student.getByRole('heading', { name: 'You\'re in. Waiting for Ms Srey Leak to start.' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Sokha Chan PC-14 .* Ready/ })).toBeVisible();
  await page.getByRole('button', { name: /^Start/ }).click();
  const bar = await windowOf(lab, 'bar');
  await expect(bar.getByRole('button', { name: 'Hand in…' })).toBeVisible({ timeout: 15_000 });

  // … and the work handed in is answered by the teacher's laptop, signed: the receipt shows
  await bar.getByRole('button', { name: 'Hand in…' }).click();
  await student.getByRole('button', { name: 'Hand in now' }).click();
  await expect(student.getByRole('heading', { name: 'Handed in' })).toBeVisible({ timeout: 15_000 });
});
