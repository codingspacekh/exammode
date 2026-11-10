import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

/** M0: the placeholder window. Student and teacher sides come in M2–M3 (architecture §2.2). */
const here = fileURLToPath(new URL('.', import.meta.url));

// Tests get their own settings folder, so they never touch a real one.
if (process.env.EXAMMODE_USER_DATA) app.setPath('userData', process.env.EXAMMODE_USER_DATA);

// One copy at a time (architecture D10).
if (!app.requestSingleInstanceLock()) app.quit();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    title: 'ExamMode',
    backgroundColor: '#f4f6f8',
    show: false,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(here, '../renderer/index.html'));
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
