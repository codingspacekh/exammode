import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/** M0 smoke: the built app opens one window titled ExamMode, themed with the prototype's accent. */
let app: ElectronApplication;
let home: string;

test.beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'exammode-e2e-')); });
test.afterEach(async () => {
  await app?.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('the window is titled ExamMode and the primary button has the accent colour', async () => {
  app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, EXAMMODE_USER_DATA: home } });
  const win = await app.firstWindow();
  await expect(win).toHaveTitle('ExamMode');
  await expect(win.getByRole('heading', { name: 'ExamMode' })).toBeVisible();
  const background = await win.getByRole('button', { name: 'Join an exam' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe('rgb(59, 79, 216)');   // --accent #3b4fd8 (design/src/styles.css)
});
