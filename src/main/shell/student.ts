/**
 * ExamMode on a lab computer (M3: nothing is locked yet). One window for the plain screens (01, 03, 09, 09b); in
 * the exam, the exam bar across the top of the screen (04) and — only if the exam has websites — the exam browser
 * under it. What they show is the student's flow (flow.ts). Electron glue: proven by the e2e tests.
 */
import { fileLog } from '../log';
import { devEnv } from './env';
import { AUTHOR, REQUEST_ADDRESS } from '@lib/trust/author';
import type { RequestForm } from '../teacher/licence';
import { teacherLicence, trust } from './trust';
import { readFile } from 'node:fs/promises';
import type { Installed } from '@lib/profiles/inventory';
import { mkdirSync } from 'node:fs';
import { hostname, uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { app, clipboard, dialog, screen, shell, type BrowserWindow } from 'electron';
import type { BrowserState, StudentState } from '@lib/app/state';
import { StudentFlow } from '../student/flow';
import type { WindowsLockdown } from '../student/lockdown-win';
import { ExamBrowser } from './browser';
import { createWindow, serve } from './windows';

/** The exam bar's height (design/src/styles.css, .xbar). */
const BAR = 54;
/** … and of the strip under it when the teacher's computer can't be reached (10b). */
const BANNER = 44;
/** How long the bar says that an app was closed (as the bar's own screen does). */
const CLOSED_MS = 8000;
const number = (text: string | undefined): number | undefined => (text ? Number(text) : undefined);

/** The lock, on a lab computer: Windows, and an installed ExamMode — or a development build told to lock
 *  (EXAMMODE_LOCK=1). Otherwise exams run unlocked. The switches below are for development and tests only. */
async function lockdownFor(env: NodeJS.ProcessEnv): Promise<WindowsLockdown | undefined> {
  if (process.platform !== 'win32' || !(app.isPackaged || env.EXAMMODE_LOCK === '1')) return undefined;
  const dev = !app.isPackaged;
  const { WindowsLockdown } = await import('../student/lockdown-win');
  const { listProcesses } = await import('../../win/processes');
  const running = dev && (env.EXAMMODE_ALLOW_RUNNING === '1' || env.EXAMMODE_KEEP_REACHABLE) ? await listProcesses(false) : [];
  const images = (keep: (p: (typeof running)[number]) => boolean) => [...new Set(running.filter((p) => p.image && keep(p)).map((p) => p.image!))];
  // what has a window when ExamMode starts is left alone (GitHub's own agent, on its computers)
  const alsoAllow = env.EXAMMODE_ALLOW_RUNNING === '1' ? images((p) => p.hasWindow) : [];
  // programs that stay reachable through the firewall, by the start of their file's name
  const prefixes = (env.EXAMMODE_KEEP_REACHABLE ?? '').split(',').filter(Boolean).map((p) => p.toLowerCase());
  const keepReachable = images((p) => prefixes.some((prefix) => p.image!.slice(p.image!.lastIndexOf('\\') + 1).toLowerCase().startsWith(prefix)));
  return new WindowsLockdown({
    examMode: process.execPath,
    guard: (dev && env.EXAMMODE_GUARD_EXE) || join(dirname(process.execPath), 'ExamModeGuard.exe'),
    displays: () => screen.getAllDisplays().length,
    clearClipboard: () => clipboard.clear(),
    profiles: join(app.getPath('userData'), 'exam-profiles'),
    endpoint: dev && env.EXAMMODE_GUARD_PORT ? { host: '127.0.0.1', port: Number(env.EXAMMODE_GUARD_PORT) } : undefined,
    allowVirtual: dev && env.EXAMMODE_ALLOW_VM === '1',
    alsoAllow, keepReachable,
  });
}

export async function runStudent(): Promise<void> {
  const env = devEnv();
  const log = fileLog(join(app.getPath('userData'), 'exammode.log'));
  const lockdown = await lockdownFor(env);
  const flow = new StudentFlow({
    lockdown,
    pc: env.EXAMMODE_PC ?? hostname().replace(/\.local$/, ''),
    examRoot: env.EXAMMODE_EXAM_ROOT ?? join(app.getPath('documents'), 'ExamMode'),
    // the minute Windows started: the same for every ExamMode until the computer restarts
    bootId: String(Math.round((Date.now() - uptime() * 1000) / 60_000)),
    discoveryPort: number(env.EXAMMODE_BEACON_PORT),
    teacherPort: number(env.EXAMMODE_PORT),
    trust: trust(env), log,
    remember: join(app.getPath('userData'), 'exam.json'),
    // what this computer has installed, for the teacher's Add an app; (development: from a file)
    installed: env.EXAMMODE_INSTALLED && !app.isPackaged
      ? async () => JSON.parse(await readFile(env.EXAMMODE_INSTALLED!, 'utf8')) as Installed
      : process.platform === 'win32' ? async () => (await import('../../win/installed')).installed() : undefined,
  });

  const main = createWindow('student', { width: 1440, height: 900, minWidth: 1280, minHeight: 720 });
  main.once('ready-to-show', () => main.show());
  // locked, ExamMode's window isn't closed by a key (Alt+F4): leaving is Leave, which asks first
  main.on('close', (event) => {
    if (flow.state().locked) event.preventDefault();
  });
  let bar: BrowserWindow | undefined;
  let browser: ExamBrowser | undefined;
  let browserState: BrowserState = { tabs: [], active: 0, sites: [] };

  const tellBrowser = serve('browser', () => browserState, {
    select: (tab: number) => browser?.select(tab),
    close: (tab: number) => browser?.close(tab),
    back: () => browser?.back(),
    forward: () => browser?.forward(),
    reload: () => browser?.reload(),
    toQuestions: () => browser?.toQuestions(),
  }, () => [browser?.window]);

  const tell = serve('student', () => flow.state(), {
    pick: (runId: string) => flow.pick(runId),
    lookAt: (host: string) => flow.lookAt(host),
    join: (studentId: string, code: string) => flow.join(studentId, code),
    checkAgain: () => flow.checkAgain(),
    lock: () => flow.lock(),
    backOut: () => flow.backOut(),
    askHandIn: () => flow.askHandIn(),
    keepWorking: () => flow.keepWorking(),
    handIn: () => flow.handIn(),
    askLeave: () => flow.askLeave(),
    leave: () => flow.leave(),
    giveUp: () => flow.giveUp(),
    finish: () => flow.finish(),
    showQuestions: () => browser?.window.show(),
    openApp: (id: string) => flow.openApp(id),
    // ── I'm a teacher… (F-44): only from the first screen, never during an exam ──
    teacherRequest: async (form: RequestForm) => {
      if (flow.state().screen !== 'join') return { error: 'Not during an exam.' };
      try {
        const made = await teacherLicence(env).request(form, `ExamMode ${app.getVersion()} · ${process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform}`);
        return 'text' in made ? { ...made, address: REQUEST_ADDRESS, author: AUTHOR } : made;
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    copyText: (text: string) => clipboard.writeText(String(text).slice(0, 4000)),
    emailRequest: (text: string) => (REQUEST_ADDRESS ? shell.openExternal(`mailto:${REQUEST_ADDRESS}?subject=${encodeURIComponent('ExamMode teacher request')}&body=${encodeURIComponent(String(text).slice(0, 4000))}`) : undefined),
    loadLicence: async () => {
      if (flow.state().screen !== 'join') return undefined;
      const [path] = env.EXAMMODE_LICENCE_FILE && !app.isPackaged ? [env.EXAMMODE_LICENCE_FILE] : (await dialog.showOpenDialog(main, { title: 'Your teacher licence', properties: ['openFile'], filters: [{ name: 'ExamMode teacher licence', extensions: ['emlicence'] }] })).filePaths;
      if (!path) return undefined;
      const loaded = await teacherLicence(env).load(path);
      return loaded.ok ? { ok: true, name: loaded.licence.name, school: loaded.licence.school, id: loaded.licence.id } : { ok: false, why: loaded.why };
    },
    restart: () => {
      if (flow.state().screen !== 'join') return;
      app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--student') });
      app.exit(0);
    },
    // M3: the computer isn't locked, so the Exam folder opens in the system's own file manager (its own list: M5)
    openFolder: () => {
      if (!flow.folder) return;
      mkdirSync(flow.folder, { recursive: true });
      return shell.openPath(flow.folder);
    },
  }, () => [main, bar]);

  /** The windows that go with a screen. */
  function arrange(state: StudentState): void {
    const inExam = state.screen === 'exam' || state.screen === 'handIn' || state.screen === 'leave';
    const area = screen.getPrimaryDisplay().workArea;
    if (inExam && !bar) {
      bar = createWindow('bar', {
        x: area.x, y: area.y, width: area.width, height: BAR, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
        fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#0f172a', title: 'ExamMode — the exam bar',
      });
      bar.setAlwaysOnTop(true, 'screen-saver');
      // (the bar goes when the exam does — `destroy` below — never by a key)
      bar.on('close', (event) => event.preventDefault());
      const made = bar;
      bar.once('ready-to-show', () => {
        made.showInactive();
        // locked: the bar holds the top of the screen — apps fill the space under it and can't cover it (D6)
        if (lockdown && flow.state().locked) void reserve(made).catch((error: unknown) => log('bar', 'the top of the screen couldn\'t be kept for the bar', error));
      });
    }
    if (inExam && !browser && flow.websites.length > 0) {
      // locked, there is no taskbar: the browser has the whole screen under the bar
      const whole = flow.state().locked ? screen.getPrimaryDisplay().bounds : area;
      browser = new ExamBrowser(flow.websites, { x: whole.x, y: whole.y + BAR, width: whole.width, height: whole.height - BAR }, {
        changed: (s) => tellBrowser(browserState = s),
        blocked: (url) => flow.report('pageBlocked', { url }),
      });
    }
    if (!inExam) {
      if (bar && barHandle !== undefined) void appbar?.release(barHandle);
      barHandle = undefined;
      bar?.destroy();
      bar = undefined;
      browser?.destroy();
      browser = undefined;
    }
    if (state.screen === 'exam') return main.hide();
    // Hand in… and Leave come up over whatever the student has open
    const asking = state.screen === 'handIn' || state.screen === 'leave';
    main.setAlwaysOnTop(asking, 'screen-saver');
    main.show();
    if (asking) main.focus();
  }

  let barHandle: bigint | undefined;
  let appbar: typeof import('../../win/appbar') | undefined;
  /** Keeps the top of the screen for the bar's window. */
  async function reserve(win: BrowserWindow): Promise<void> {
    appbar ??= await import('../../win/appbar');
    const display = screen.getPrimaryDisplay();
    const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
    const px = (dip: number) => Math.round(dip * display.scaleFactor);
    const top = await appbar.reserveTop(hwnd, px(display.size.width), px(BAR), px(display.size.height));
    if (top === undefined || win.isDestroyed()) return;
    barHandle = hwnd;
    lockdown?.setBar(hwnd);
    win.setBounds({ x: display.bounds.x, y: Math.round(top / display.scaleFactor), width: display.size.width, height: win.getBounds().height });
  }

  let shown: StudentState['screen'] = 'join';
  let locked = false;
  let contact = true;
  let closedAt: number | undefined;
  let closedTimer: NodeJS.Timeout | undefined;
  /** The bar's height: with a strip under it while there is something to say. */
  function resize(state: StudentState): void {
    if (!bar || bar.isDestroyed()) return;
    const recent = (said?: { at: number }) => said !== undefined && Date.now() - said.at < CLOSED_MS;
    const strip = !state.contact || recent(state.closed) || recent(state.appMissing);
    // (locked, the bar itself holds the top of the screen: the work area starts under it)
    const display = screen.getPrimaryDisplay();
    const area = state.locked ? display.bounds : display.workArea;
    bar.setBounds({ x: area.x, y: area.y, width: area.width, height: strip ? BAR + BANNER : BAR });
  }
  flow.onState((state) => {
    tell(state);
    // with no contact the bar grows by a strip that says so (10b)
    // … and for a few seconds when an app was closed (07)
    const saidAt = Math.max(state.closed?.at ?? 0, state.appMissing?.at ?? 0) || undefined;
    if (saidAt !== closedAt) {
      closedAt = saidAt;
      clearTimeout(closedTimer);
      if (closedAt) closedTimer = setTimeout(() => resize(flow.state()), CLOSED_MS + 200);
    }
    if (state.contact !== contact || saidAt) resize(state);
    contact = state.contact;
    // F-07: locked, ExamMode fills the screen — there is nothing else to go to
    if (state.locked !== locked) {
      locked = state.locked;
      main.setKiosk(locked);
      // locked after the bar was made (a student who was let back in is in the exam at once, and the lock
      // follows): the bar takes the top of the screen now
      if (locked && lockdown && bar && !bar.isDestroyed() && barHandle === undefined) void reserve(bar).catch((error: unknown) => log('bar', 'the top of the screen couldn\'t be kept for the bar', error));
    }
    if (state.screen === shown) return;
    shown = state.screen;
    arrange(state);
  });
  app.on('before-quit', () => void flow.stop());
  // F-04: a second screen plugged in during the exam is a warning for the teacher
  screen.on('display-added', () => {
    if (flow.state().locked) flow.report('displayAdded', {});
  });
  await flow.start();
  // started again by the Guard after stopping suddenly: back to the exam, to say why this student is locked out
  const resume = process.argv.indexOf('--resume');
  if (resume >= 0 && process.argv[resume + 1]) void flow.resume(process.argv[resume + 1]!);
}
