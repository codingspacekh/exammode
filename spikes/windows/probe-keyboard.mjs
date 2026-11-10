// R1 / F-14: can a koffi hook in a worker swallow the Windows key and Ctrl+Esc, reliably, for a long time?
// node spikes/windows/probe-keyboard.mjs [seconds]   (default 60; the lab run uses 1800)
import { Worker } from 'node:worker_threads';
import * as w from './win32.mjs';

const seconds = Number(process.argv[2] ?? 60);
const VK = { LWIN: 0x5b, ESC: 0x1b, CONTROL: 0x11, MENU: 0x12, F23: 0x86, F24: 0x87 };
const KEYUP = 0x0002;

function start(role) {
  const worker = new Worker(new URL('./keyboard-worker.mjs', import.meta.url), { workerData: { role } });
  const ready = new Promise((resolve) => worker.on('message', (m) => m.type === 'ready' && resolve(m)));
  const done = new Promise((resolve) => worker.on('message', (m) => m.type === 'done' && resolve(m)));
  return { worker, ready, done };
}
const tap = (vk) => { w.keybd_event(vk, 0, 0, 0); w.keybd_event(vk, 0, KEYUP, 0); };
const chord = (mod, vk) => { w.keybd_event(mod, 0, 0, 0); tap(vk); w.keybd_event(mod, 0, KEYUP, 0); };

// the probe is installed first, the blocker second: Windows calls the newest hook first
const probe = start('probe');
const probeReady = await probe.ready;
const blocker = start('blocker');
const blockerReady = await blocker.ready;
await w.sleep(300);

tap(VK.F24);
tap(VK.LWIN);
chord(VK.CONTROL, VK.ESC);
chord(VK.MENU, VK.ESC);
tap(VK.F24);
await w.sleep(300);

// keep both hooks busy: 20 harmless F24 presses a second, then one F23 to show each hook is still there
const t0 = Date.now();
let sent = 2;
while (Date.now() - t0 < seconds * 1000) {
  tap(VK.F24);
  sent++;
  await w.sleep(50);
}
tap(VK.F23);
await w.sleep(500);

w.PostThreadMessageW(probeReady.threadId, w.WM_QUIT, 0, 0);
w.PostThreadMessageW(blockerReady.threadId, w.WM_QUIT, 0, 0);
const [p, b] = await Promise.all([probe.done, blocker.done]);
await Promise.all([probe.worker.terminate(), blocker.worker.terminate()]);

const result = {
  seconds,
  hooksInstalled: probeReady.ok && blockerReady.ok,
  f24Sent: sent,
  probeSawF24: p.seen[VK.F24] ?? 0,
  blockerSawF24: b.seen[VK.F24] ?? 0,
  bothAliveAtEnd: Boolean(p.seen[VK.F23]) && Boolean(b.seen[VK.F23]),
  winKeyReachedNextHook: Boolean(p.seen[VK.LWIN]),
  escReachedNextHook: p.seen[VK.ESC] ?? 0,
  blockerSwallowed: b.swallowed,
  maxCallbackMs: Math.max(p.maxCallbackMs, b.maxCallbackMs),
};
result.pass = result.hooksInstalled && result.bothAliveAtEnd && !result.winKeyReachedNextHook && result.escReachedNextHook === 0 && result.probeSawF24 >= sent;
w.report(result);
process.exit(0);
