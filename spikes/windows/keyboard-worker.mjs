// One low-level keyboard hook on its own thread with its own message loop (architecture §2.5, R1).
// role 'blocker' swallows the Windows keys, Ctrl+Esc and Alt+Esc; role 'probe' only watches.
import { parentPort, workerData } from 'node:worker_threads';
import koffi from 'koffi';
import * as w from './win32.mjs';

const { role } = workerData;
const VK = { LWIN: 0x5b, RWIN: 0x5c, ESC: 0x1b, CONTROL: 0x11, MENU: 0x12 };
const seen = {};
let maxMs = 0;
let calls = 0;
let swallowed = 0;

function swallow(vk) {
  if (vk === VK.LWIN || vk === VK.RWIN) return true;
  if (vk === VK.ESC && (w.GetAsyncKeyState(VK.CONTROL) & 0x8000)) return true;
  if (vk === VK.ESC && (w.GetAsyncKeyState(VK.MENU) & 0x8000)) return true;
  return false;
}

let hook = null;
const cb = koffi.register((nCode, wParam, lParam) => {
  const t0 = performance.now();
  try {
    if (nCode === 0) {
      const k = koffi.decode(lParam, w.KBDLLHOOKSTRUCT);
      calls++;
      if (wParam === w.WM_KEYDOWN || wParam === w.WM_SYSKEYDOWN) seen[k.vkCode] = (seen[k.vkCode] ?? 0) + 1;
      if (role === 'blocker' && swallow(k.vkCode)) {
        swallowed++;
        return 1;
      }
    }
    return w.CallNextHookEx(hook, nCode, wParam, lParam);
  } finally {
    maxMs = Math.max(maxMs, performance.now() - t0);
  }
}, koffi.pointer(w.HookProc));

hook = w.SetWindowsHookExW(w.WH_KEYBOARD_LL, cb, w.GetModuleHandleW(null), 0);
parentPort.postMessage({ type: 'ready', ok: Boolean(hook), threadId: w.GetCurrentThreadId() });

const msg = {};
while (w.GetMessageW(msg, null, 0, 0) > 0) {
  w.TranslateMessage(msg);
  w.DispatchMessageW(msg);
}
w.UnhookWindowsHookEx(hook);
koffi.unregister(cb);
parentPort.postMessage({ type: 'done', role, seen, calls, swallowed, maxCallbackMs: Number(maxMs.toFixed(3)) });
