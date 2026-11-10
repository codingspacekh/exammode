// N-02 / F-12: how soon is a new window seen, and how soon is its program closed? Also: one EnumWindows sweep's cost.
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import * as w from './win32.mjs';

const worker = new Worker(new URL('./winevent-worker.mjs', import.meta.url));
const shown = [];
let ready;
const isReady = new Promise((r) => (ready = r));
worker.on('message', (m) => {
  if (m.type === 'ready') ready(m);
  if (m.type === 'shown') shown.push(m);
});
const info = await isReady;

const runs = [];
for (let i = 0; i < 5; i++) {
  shown.length = 0;
  const t0 = w.now();
  spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref();
  let hit;
  while (!hit && w.now() - t0 < 10_000) {
    await w.sleep(5);
    hit = shown.find((s) => /notepad\.exe$/i.test(s.image ?? ''));
  }
  if (!hit) { runs.push({ seen: false }); continue; }
  const killMs = w.terminate(hit.pid);
  const closedAt = w.now();
  runs.push({ seen: true, startToSeenMs: Math.round(hit.at - t0), seenToClosedMs: Math.round(closedAt - hit.at), terminateMs: Math.round(killMs ?? -1), image: hit.image });
  await w.sleep(500);
}

// the 500 ms backstop: one sweep of every top-level window, with each program's path
const t0 = performance.now();
let windows = 0;
w.EnumWindows((hwnd) => {
  if (w.IsWindowVisible(hwnd)) {
    const pid = [0];
    w.GetWindowThreadProcessId(hwnd, pid);
    w.imageOf(pid[0]);
    windows++;
  }
  return true;
}, 0);
const sweepMs = performance.now() - t0;

w.PostThreadMessageW(info.threadId, w.WM_QUIT, 0, 0);
await w.sleep(200);
await worker.terminate();

const seen = runs.filter((r) => r.seen);
const worst = Math.max(...seen.map((r) => r.seenToClosedMs));
w.report({
  hookInstalled: info.ok,
  runs,
  worstSeenToClosedMs: Number.isFinite(worst) ? worst : null,
  sweepMs: Number(sweepMs.toFixed(1)),
  visibleWindows: windows,
  pass: info.ok && seen.length === runs.length && worst < 1000,
});
process.exit(0);
