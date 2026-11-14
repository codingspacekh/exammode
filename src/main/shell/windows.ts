/**
 * ExamMode's windows (Electron glue: proven by the e2e tests, not the unit ones). Every window shows the same
 * renderer; `?view=` says which screen it is. The renderer reaches the system only through the preload script.
 */
import { join } from 'node:path';
import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron';

export type View = 'student' | 'teacher' | 'bar' | 'browser';

/** Where the built app is: set once by index.ts. */
let out = '';
export const setOut = (folder: string): void => void (out = folder);
export const preload = (): string => join(out, '../preload/index.cjs');

export function createWindow(view: View, options: BrowserWindowConstructorOptions = {}): BrowserWindow {
  const win = new BrowserWindow({
    title: 'ExamMode',
    backgroundColor: '#f4f6f8',
    show: false,
    ...options,
    webPreferences: { preload: preload(), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // nothing in a screen opens another window or leaves the app
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`);
  else void win.loadFile(join(out, '../renderer/index.html'), { query: { view } });
  return win;
}

/** Answers a side's calls from its screens (`name:call`), and gives back how to push its state to them. */
export function serve<S>(name: string, get: () => S, calls: Record<string, (...args: never[]) => unknown>, windows: () => (BrowserWindow | undefined)[]): (state: S) => void {
  ipcMain.handle(`${name}:get`, () => get());
  for (const [call, run] of Object.entries(calls)) ipcMain.handle(`${name}:${call}`, (_event, ...args) => (run as (...a: unknown[]) => unknown)(...args));
  return (state) => {
    for (const win of windows()) if (win && !win.isDestroyed()) win.webContents.send(`${name}:state`, state);
  };
}
