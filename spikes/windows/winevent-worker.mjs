// A window-event hook (EVENT_OBJECT_SHOW) on its own thread with its own message loop (architecture §2.5, N-02).
import { parentPort } from 'node:worker_threads';
import koffi from 'koffi';
import * as w from './win32.mjs';

const WINEVENT_OUTOFCONTEXT = 0x0000;
const WINEVENT_SKIPOWNPROCESS = 0x0002;

const cb = koffi.register((hook, event, hwnd, idObject, idChild) => {
  if (idObject !== 0 || idChild !== 0 || !hwnd || !w.IsWindowVisible(hwnd)) return;
  const pid = [0];
  w.GetWindowThreadProcessId(hwnd, pid);
  parentPort.postMessage({ type: 'shown', at: w.now(), pid: pid[0], image: w.imageOf(pid[0]) });
}, koffi.pointer(w.WinEventProc));

const hook = w.SetWinEventHook(w.EVENT_OBJECT_SHOW, w.EVENT_OBJECT_SHOW, null, cb, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
parentPort.postMessage({ type: 'ready', ok: Boolean(hook), threadId: w.GetCurrentThreadId() });

const msg = {};
while (w.GetMessageW(msg, null, 0, 0) > 0) {
  w.TranslateMessage(msg);
  w.DispatchMessageW(msg);
}
w.UnhookWinEvent(hook);
koffi.unregister(cb);
parentPort.postMessage({ type: 'done' });
