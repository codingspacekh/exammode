/**
 * The exam bar holds the top of the screen (D6, F-09): a maximised app fills the space under it and can't cover
 * it. With Explorer running that is a Windows AppBar, like the taskbar (proven in M0's spike). But the AppBar is
 * Explorer's doing, and the lockdown stops Explorer (D7) — found by M4's e2e test. So, with no shell to ask, the
 * screen's work area is set directly: everything but the bar. Explorer works it out again when it is started.
 */
import type * as Koffi from 'koffi';

const ABM_NEW = 0;
const ABM_REMOVE = 1;
const ABM_QUERYPOS = 2;
const ABM_SETPOS = 3;
const ABE_TOP = 1;
const SPI_SETWORKAREA = 0x002f;
const SPI_GETWORKAREA = 0x0030;
const SPIF_SENDCHANGE = 0x0002;

interface Rect { left: number; top: number; right: number; bottom: number }
interface Api {
  size: number;
  appbar(msg: number, data: Record<string, unknown>): number | bigint;
  getWorkArea(): Rect;
  setWorkArea(rect: Rect): boolean;
}
let api: Api | undefined;
/** how the top was taken: as an AppBar, or by the work area — with what it was before */
let held: { hwnd: bigint; before?: Rect } | undefined;

async function load(): Promise<Api> {
  if (api) return api;
  const koffi: typeof Koffi.default = (await import('koffi')).default;
  const RECT = koffi.struct('APPBAR_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const APPBARDATA = koffi.struct('APPBARDATA', { cbSize: 'uint32', hWnd: 'uintptr', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr' });
  const user32 = koffi.load('user32.dll');
  const get = user32.func('bool __stdcall SystemParametersInfoW(uint32 action, uint32 param, _Out_ APPBAR_RECT *rect, uint32 change)');
  const set = user32.func('SystemParametersInfoW', 'bool', ['uint32', 'uint32', koffi.pointer(RECT), 'uint32']);
  api = {
    size: koffi.sizeof(APPBARDATA),
    appbar: koffi.load('shell32.dll').func('uintptr __stdcall SHAppBarMessage(uint32 msg, _Inout_ APPBARDATA *data)') as Api['appbar'],
    getWorkArea() {
      const rect = {} as Rect;
      get(SPI_GETWORKAREA, 0, rect, 0);
      return rect;
    },
    setWorkArea: (rect) => Boolean(set(SPI_SETWORKAREA, 0, rect, SPIF_SENDCHANGE)),
  };
  return api;
}

/** Keeps the top `height` pixels of the screen (`width` × `screenHeight` pixels) for this window. Answers where
 *  the bar's top is, in pixels; nothing if Windows refused both ways. */
export async function reserveTop(hwnd: bigint, width: number, height: number, screenHeight: number): Promise<number | undefined> {
  const win = await load();
  const data = { cbSize: win.size, hWnd: hwnd, uCallbackMessage: 0x0401, uEdge: ABE_TOP, rc: { left: 0, top: 0, right: width, bottom: height }, lParam: 0 };
  if (Number(win.appbar(ABM_NEW, data)) !== 0) {
    win.appbar(ABM_QUERYPOS, data);
    data.rc.bottom = data.rc.top + height;
    win.appbar(ABM_SETPOS, data);
    // with no shell running the messages are answered by nobody: only believe it if the work area moved
    if (win.getWorkArea().top >= data.rc.top + height) {
      held = { hwnd };
      return data.rc.top;
    }
    win.appbar(ABM_REMOVE, data);
  }
  const before = win.getWorkArea();
  if (!win.setWorkArea({ left: 0, top: height, right: width, bottom: screenHeight })) return undefined;
  held = { hwnd, before };
  return 0;
}

/** Gives the top of the screen back. */
export async function release(hwnd: bigint): Promise<void> {
  const win = await load();
  const was = held;
  held = undefined;
  if (was?.before) win.setWorkArea({ ...was.before, top: Math.min(was.before.top, 0) });
  else win.appbar(ABM_REMOVE, { cbSize: win.size, hWnd: hwnd, uCallbackMessage: 0, uEdge: ABE_TOP, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 });
}
