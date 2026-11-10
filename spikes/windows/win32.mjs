// M0 spike (MILESTONES §6, M0 step 5): the Windows calls the probes use, through koffi 3.
// Throw-away code (T10): never imported by src/. Pointers and handles are BigInts in koffi 3.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import koffi from 'koffi';

export const user32 = koffi.load('user32.dll');
export const kernel32 = koffi.load('kernel32.dll');
export const shell32 = koffi.load('shell32.dll');

export const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
export const HWND = koffi.alias('HWND', HANDLE);
export const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
export const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
export const MSG = koffi.struct('MSG', { hwnd: HWND, message: 'uint32', wParam: 'uintptr', lParam: 'intptr', time: 'uint32', pt: POINT, lPrivate: 'uint32' });
export const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', { vkCode: 'uint32', scanCode: 'uint32', flags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
export const APPBARDATA = koffi.struct('APPBARDATA', { cbSize: 'uint32', hWnd: 'uintptr', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr' });

export const HookProc = koffi.proto('intptr __stdcall HookProc(int nCode, uintptr wParam, void *lParam)');
export const WinEventProc = koffi.proto('void __stdcall WinEventProc(HANDLE hook, uint32 event, HWND hwnd, long idObject, long idChild, uint32 thread, uint32 time)');
export const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, intptr lParam)');

export const SetWindowsHookExW = user32.func('HANDLE __stdcall SetWindowsHookExW(int idHook, HookProc *lpfn, HANDLE hmod, uint32 dwThreadId)');
export const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(HANDLE hhk)');
export const CallNextHookEx = user32.func('intptr __stdcall CallNextHookEx(HANDLE hhk, int nCode, uintptr wParam, void *lParam)');
export const SetWinEventHook = user32.func('HANDLE __stdcall SetWinEventHook(uint32 eventMin, uint32 eventMax, HANDLE hmod, WinEventProc *pfn, uint32 idProcess, uint32 idThread, uint32 flags)');
export const UnhookWinEvent = user32.func('bool __stdcall UnhookWinEvent(HANDLE hook)');
export const GetMessageW = user32.func('int __stdcall GetMessageW(_Out_ MSG *msg, HWND hwnd, uint32 min, uint32 max)');
export const TranslateMessage = user32.func('bool __stdcall TranslateMessage(const MSG *msg)');
export const DispatchMessageW = user32.func('intptr __stdcall DispatchMessageW(const MSG *msg)');
export const PostThreadMessageW = user32.func('bool __stdcall PostThreadMessageW(uint32 thread, uint32 msg, uintptr wParam, intptr lParam)');
export const keybd_event = user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)');
export const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vk)');
export const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32 *pid)');
export const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hwnd)');
export const FindWindowW = user32.func('HWND __stdcall FindWindowW(const char16_t *cls, const char16_t *name)');
export const GetWindowRect = user32.func('bool __stdcall GetWindowRect(HWND hwnd, _Out_ RECT *rect)');
export const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr lParam)');
export const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint32 action, uint32 uiParam, _Out_ RECT *pv, uint32 winIni)');
export const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
export const SHAppBarMessage = shell32.func('uintptr __stdcall SHAppBarMessage(uint32 msg, _Inout_ APPBARDATA *data)');
export const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()');
export const GetModuleHandleW = kernel32.func('HANDLE __stdcall GetModuleHandleW(const char16_t *name)');
export const OpenProcess = kernel32.func('HANDLE __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
export const CloseHandle = kernel32.func('bool __stdcall CloseHandle(HANDLE h)');
export const TerminateProcess = kernel32.func('bool __stdcall TerminateProcess(HANDLE h, uint32 code)');
export const WaitForSingleObject = kernel32.func('uint32 __stdcall WaitForSingleObject(HANDLE h, uint32 ms)');
export const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(HANDLE h, uint32 flags, _Out_ void *buf, _Inout_ uint32 *size)');

export const WM_QUIT = 0x0012;
export const WM_KEYDOWN = 0x0100;
export const WM_SYSKEYDOWN = 0x0104;
export const WH_KEYBOARD_LL = 13;
export const EVENT_OBJECT_SHOW = 0x8002;
export const PROCESS_TERMINATE = 0x0001;
export const SYNCHRONIZE = 0x00100000;
export const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

/** The full path of a process's program, or null. */
export function imageOf(pid) {
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!h) return null;
  try {
    const buf = Buffer.alloc(2048);
    const size = [1024];
    return QueryFullProcessImageNameW(h, 0, buf, size) ? buf.toString('utf16le', 0, size[0] * 2) : null;
  } finally {
    CloseHandle(h);
  }
}

/** Ends a process and returns how long until it was gone, in ms (or null if it couldn't be opened). */
export function terminate(pid) {
  const t0 = performance.now();
  const h = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, false, pid);
  if (!h) return null;
  try {
    TerminateProcess(h, 1);
    WaitForSingleObject(h, 5000);
    return performance.now() - t0;
  } finally {
    CloseHandle(h);
  }
}

/** PowerShell, returning its output (trimmed). */
export function ps(command) {
  // a computer's installed apps can be several MB of JSON: well past Node's 1 MB default
  // Without PSModulePath: one set by PowerShell 7 (GitHub's default shell) stops Windows PowerShell 5 loading its own
  // modules (Get-AuthenticodeSignature), and Windows PowerShell rebuilds the default itself
  const env = { ...process.env };
  delete env.PSModulePath;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 2 ** 20, env }).trim();
}
export function psJson(command) {
  // Through a file, not the pipe: Windows PowerShell 5 can break long piped output lines inside a JSON value
  const file = join(tmpdir(), `exammode-spike-${process.pid}-${Date.now()}.json`);
  try {
    // `exit 0`: errors told to be quiet (-ErrorAction SilentlyContinue) still make Windows PowerShell exit with 1;
    // the file is what counts
    ps(`${command} | ConvertTo-Json -Depth 4 -Compress | Set-Content -Encoding UTF8 -LiteralPath '${file}'; exit 0`);
    if (!existsSync(file)) return null;
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!text) return null;
    try {
      // Windows PowerShell 5 leaves control characters (found in some apps' names) unescaped
      return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));
    } catch (e) {
      const at = Number(/position (\d+)/.exec(String(e))?.[1] ?? 0);
      throw new Error(`PowerShell's JSON didn't parse near ${at}: …${text.slice(Math.max(0, at - 80), at + 80)}…`);
    }
  } finally {
    rmSync(file, { force: true });
  }
}
export function run(file, args) {
  try {
    return { ok: true, out: execFileSync(file, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 2 ** 20 }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? '').trim(), err: String(e.stderr ?? e.message).trim() };
  }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => performance.timeOrigin + performance.now();

/** Each probe ends by printing one line: RESULT {json}. */
export function report(result) {
  console.log(`RESULT ${JSON.stringify(result)}`);
}
