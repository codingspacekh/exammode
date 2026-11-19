/**
 * ExamMode's windows (Electron glue: proven by the e2e tests, not the unit ones). Every window shows the same
 * renderer; `?view=` says which screen it is. The renderer reaches the system only through the preload script.
 */
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron';
import { channel, type ApiOf, type Handlers, type Side, type StateOf } from '@contracts/ipc/calls';
import type { View } from '@contracts/ipc/api';
import { devEnv } from './env';

export type { View };

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
    // (the developer's tools are a development build's: in an exam they would be a way to change the screens)
    webPreferences: { preload: preload(), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: !app.isPackaged },
  });
  // nothing in a screen opens another window or leaves the app
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  const dev = devEnv().ELECTRON_RENDERER_URL;
  if (dev) void win.loadURL(`${dev}?view=${view}`);
  else void win.loadFile(join(out, '../renderer/index.html'), { query: { view } });
  return win;
}

/** Answers a side's calls from its screens (contracts/ipc/calls.ts' channels), and gives back how to push its
 *  state to them. */
export function serve<S extends Side>(side: S, get: () => StateOf<ApiOf[S]>, calls: Handlers<ApiOf[S]>, windows: () => (BrowserWindow | undefined)[]): (state: StateOf<ApiOf[S]>) => void {
  ipcMain.handle(channel.get(side), () => get());
  for (const [call, run] of Object.entries(calls) as [string, (...a: unknown[]) => unknown][]) {
    ipcMain.handle(channel.call(side, call), (_event, ...args) => run(...args));
  }
  return (state) => {
    for (const win of windows()) if (win && !win.isDestroyed()) win.webContents.send(channel.state(side), state);
  };
}
