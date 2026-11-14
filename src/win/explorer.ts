/**
 * Explorer — the taskbar, Start and the desktop (D7): stopped for the exam, started again afterwards in the
 * student's session.
 */
import { spawn } from 'node:child_process';
import { run } from './run';
import { startInUserSession } from './session';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function explorerRunning(): Promise<boolean> {
  return /explorer\.exe/i.test((await run('tasklist.exe', ['/fi', 'imagename eq explorer.exe', '/nh', '/fo', 'csv'])).out);
}

async function until(state: boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if ((await explorerRunning()) === state) return true;
  return (await explorerRunning()) === state;
}

/** Stops every Explorer. (The plan has told Windows not to start it again, first.) */
export async function stopExplorer(): Promise<void> {
  if (!(await explorerRunning())) return;
  await run('taskkill.exe', ['/f', '/im', 'explorer.exe']);
  if (!(await until(false, 10_000))) throw new Error('Explorer couldn\'t be stopped');
}

/** Starts Explorer in the session of whoever sits at the computer: the Guard itself runs as a service, which has
 *  no desktop. */
export async function startExplorer(): Promise<void> {
  if (await explorerRunning()) return;
  if (!startInUserSession('explorer.exe')) spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
  if (!(await until(true, 20_000))) throw new Error('Explorer couldn\'t be started');
}
