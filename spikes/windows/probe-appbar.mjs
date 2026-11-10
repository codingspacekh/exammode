// D6 / F-09: an Electron window as a Windows AppBar at the top. Does a maximised app fill the space under it?
// Run with Electron: npx electron spikes/windows/probe-appbar.mjs
import { spawn } from 'node:child_process';
import { app, BrowserWindow, screen } from 'electron';
import koffi from 'koffi';
import * as w from './win32.mjs';

const ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3, ABE_TOP = 1, SPI_GETWORKAREA = 0x0030;
const BAR_DIP = 54;

function workArea() {
  const r = {};
  w.SystemParametersInfoW(SPI_GETWORKAREA, 0, r, 0);
  return r;
}

app.whenReady().then(async () => {
  const result = {};
  try {
    const display = screen.getPrimaryDisplay();
    const scale = display.scaleFactor;
    const barPx = Math.round(BAR_DIP * scale);
    result.screen = { dip: display.size, scale };
    result.workAreaBefore = workArea();

    const win = new BrowserWindow({ x: 0, y: 0, width: display.size.width, height: BAR_DIP, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: true, backgroundColor: '#0f172a' });
    await win.loadURL('data:text/html,<body style="margin:0;background:%230f172a;color:white;font:14px sans-serif;padding:16px">ExamMode spike — the exam bar</body>');
    const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0);

    const abd = { cbSize: koffi.sizeof(w.APPBARDATA), hWnd: hwnd, uCallbackMessage: 0x0401, uEdge: ABE_TOP, rc: { left: 0, top: 0, right: Math.round(display.size.width * scale), bottom: barPx }, lParam: 0 };
    result.registered = Number(w.SHAppBarMessage(ABM_NEW, abd)) !== 0;
    w.SHAppBarMessage(ABM_QUERYPOS, abd);
    abd.rc.bottom = abd.rc.top + barPx;
    w.SHAppBarMessage(ABM_SETPOS, abd);
    win.setBounds({ x: 0, y: Math.round(abd.rc.top / scale), width: display.size.width, height: BAR_DIP });
    await w.sleep(800);
    result.barRect = abd.rc;
    result.workAreaWithBar = workArea();

    spawn('cmd.exe', ['/c', 'start', '/max', 'notepad.exe'], { stdio: 'ignore', windowsHide: true });
    let notepad = null;
    for (let i = 0; i < 40 && !notepad; i++) { await w.sleep(250); notepad = w.FindWindowW('Notepad', null); }
    if (notepad) {
      await w.sleep(800);
      const r = {};
      w.GetWindowRect(notepad, r);
      result.notepadMaximised = r;
      const pid = [0];
      w.GetWindowThreadProcessId(notepad, pid);
      w.terminate(pid[0]);
    }

    w.SHAppBarMessage(ABM_REMOVE, abd);
    await w.sleep(800);
    result.workAreaAfter = workArea();

    const wa = result.workAreaWithBar;
    result.pass = result.registered
      && wa.top >= barPx - 2
      && Boolean(result.notepadMaximised) && result.notepadMaximised.top >= wa.top - 16
      && result.workAreaAfter.top === result.workAreaBefore.top;
  } catch (e) {
    result.error = String(e?.stack ?? e);
    result.pass = false;
  }
  w.report(result);
  app.exit(0);
});
