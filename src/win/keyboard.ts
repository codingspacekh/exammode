/**
 * The keyboard during an exam (F-14, architecture §2.5): a low-level keyboard hook that swallows the keys of
 * src/lib/guard/keys.ts and passes everything else on. It runs on a thread of its own with its own message loop,
 * so that it always answers Windows in time (M0: R1). The thread's code is kept here as text: it needs nothing
 * built or bundled, and runs the same in the app, in the tests and in the installed program.
 */
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { RULES, swallowBy, type KeyRules } from '@lib/guard/keys';

const THREAD = `
const { workerData, parentPort } = require('node:worker_threads');
const koffi = require(workerData.koffi);
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
const MSG = koffi.struct('MSG', { hwnd: 'void *', message: 'uint32', wParam: 'uintptr', lParam: 'intptr', time: 'uint32', pt: POINT, lPrivate: 'uint32' });
const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', { vkCode: 'uint32', scanCode: 'uint32', flags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
const HookProc = koffi.proto('intptr __stdcall HookProc(int nCode, uintptr wParam, void *lParam)');
const SetWindowsHookExW = user32.func('void * __stdcall SetWindowsHookExW(int idHook, HookProc *lpfn, void *hmod, uint32 dwThreadId)');
const CallNextHookEx = user32.func('intptr __stdcall CallNextHookEx(void *hhk, int nCode, uintptr wParam, void *lParam)');
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vk)');
const GetForegroundWindow = user32.func('uintptr __stdcall GetForegroundWindow()');
const GetMessageW = user32.func('int __stdcall GetMessageW(_Out_ MSG *msg, void *hwnd, uint32 min, uint32 max)');
const TranslateMessage = user32.func('bool __stdcall TranslateMessage(const MSG *msg)');
const DispatchMessageW = user32.func('intptr __stdcall DispatchMessageW(const MSG *msg)');
const GetModuleHandleW = kernel32.func('void * __stdcall GetModuleHandleW(const char16_t *name)');

const swallowBy = ${swallowBy.toString()};
const rules = workerData.rules;
const bar = new BigInt64Array(workerData.bar);
const seen = new Int32Array(workerData.seen);
const swallowed = new Int32Array(workerData.swallowed);
const down = (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0;

let hook = null;
const each = koffi.register((nCode, wParam, lParam) => {
  if (nCode === 0) {
    const vk = koffi.decode(lParam, KBDLLHOOKSTRUCT).vkCode;
    // WM_KEYDOWN, WM_SYSKEYDOWN
    if (wParam === 0x100 || wParam === 0x104) Atomics.add(seen, vk & 255, 1);
    if (workerData.block && swallowBy(rules, { vk, ctrl: down(0x11), alt: down(0x12), onBar: BigInt(GetForegroundWindow()) === Atomics.load(bar, 0) })) {
      Atomics.add(swallowed, 0, 1);
      return 1;
    }
  }
  return CallNextHookEx(hook, nCode, wParam, lParam);
}, koffi.pointer(HookProc));

// WH_KEYBOARD_LL
hook = SetWindowsHookExW(13, each, GetModuleHandleW(null), 0);
parentPort.postMessage({ ready: Boolean(hook) });
const msg = {};
while (GetMessageW(msg, null, 0, 0) > 0) {
  TranslateMessage(msg);
  DispatchMessageW(msg);
}
`;

export class KeyboardHook {
  private worker?: Worker;
  private readonly bar = new SharedArrayBuffer(8);
  private readonly seenKeys = new SharedArrayBuffer(4 * 256);
  private readonly swallowedCount = new SharedArrayBuffer(4);

  /** `block: false` only watches: the tests use one to see which keys still get through. */
  constructor(private readonly rules: KeyRules = RULES, private readonly block = true) {}

  /** Installs the hook. Fails if Windows doesn't take it. */
  start(): Promise<void> {
    if (this.worker) return Promise.resolve();
    const koffi = createRequire(import.meta.url).resolve('koffi');
    const worker = new Worker(THREAD, { eval: true, workerData: { koffi, rules: this.rules, block: this.block, bar: this.bar, seen: this.seenKeys, swallowed: this.swallowedCount } });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('message', (m: { ready: boolean }) => (m.ready ? resolve() : reject(new Error('Windows didn\'t take the keyboard hook'))));
    });
  }

  /** The exam bar's window: Alt+Space is swallowed while it is in front. */
  setBar(hwnd: bigint): void {
    Atomics.store(new BigInt64Array(this.bar), 0, hwnd);
  }

  /** How many times a key went down (by its virtual-key code), as this hook saw it. */
  seen(vk: number): number {
    return Atomics.load(new Int32Array(this.seenKeys), vk & 255);
  }

  /** How many key events were swallowed. */
  get swallowed(): number {
    return Atomics.load(new Int32Array(this.swallowedCount), 0);
  }

  /** Removes the hook: Windows takes it away with its thread. */
  async stop(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    await worker?.terminate();
  }
}
