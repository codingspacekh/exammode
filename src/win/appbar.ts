/**
 * The exam bar as a Windows AppBar (D6, F-09): like the taskbar, it reserves the top of the screen, so a maximised
 * app fills the space under it and can't cover it. Proven in M0's spike (docs/acceptance/M0.md).
 */
import type * as Koffi from 'koffi';

const ABM_NEW = 0;
const ABM_REMOVE = 1;
const ABM_QUERYPOS = 2;
const ABM_SETPOS = 3;
const ABE_TOP = 1;

let message: ((msg: number, data: Record<string, unknown>) => number | bigint) | undefined;
let size = 0;
async function load(): Promise<NonNullable<typeof message>> {
  if (message) return message;
  const koffi: typeof Koffi.default = (await import('koffi')).default;
  const RECT = koffi.struct('APPBAR_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const APPBARDATA = koffi.struct('APPBARDATA', { cbSize: 'uint32', hWnd: 'uintptr', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr' });
  size = koffi.sizeof(APPBARDATA);
  message = koffi.load('shell32.dll').func('uintptr __stdcall SHAppBarMessage(uint32 msg, _Inout_ APPBARDATA *data)') as NonNullable<typeof message>;
  return message;
}

/** Reserves the top `height` pixels of a screen `width` pixels wide for this window. Answers where Windows put
 *  the bar (its top, in pixels), or nothing if Windows refused. */
export async function reserveTop(hwnd: bigint, width: number, height: number): Promise<number | undefined> {
  const send = await load();
  const data = { cbSize: size, hWnd: hwnd, uCallbackMessage: 0x0401, uEdge: ABE_TOP, rc: { left: 0, top: 0, right: width, bottom: height }, lParam: 0 };
  if (Number(send(ABM_NEW, data)) === 0) return undefined;
  send(ABM_QUERYPOS, data);
  data.rc.bottom = data.rc.top + height;
  send(ABM_SETPOS, data);
  return data.rc.top;
}

/** Gives the top of the screen back. */
export async function release(hwnd: bigint): Promise<void> {
  const send = await load();
  send(ABM_REMOVE, { cbSize: size, hWnd: hwnd, uCallbackMessage: 0, uEdge: ABE_TOP, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 });
}
