/**
 * ExamMode on a lab computer (M3: nothing is locked yet). One window for the plain screens (01, 03, 09, 09b); in
 * the exam, the exam bar across the top of the screen (04) and — only if the exam has websites — the exam browser
 * under it. What they show is the student's flow (flow.ts). Electron glue: proven by the e2e tests.
 */
import { mkdirSync } from 'node:fs';
import { hostname, uptime } from 'node:os';
import { join } from 'node:path';
import { app, screen, shell, type BrowserWindow } from 'electron';
import type { BrowserState, StudentState } from '@lib/app/state';
import { StudentFlow } from '../student/flow';
import { ExamBrowser } from './browser';
import { createWindow, serve } from './windows';

/** The exam bar's height (design/src/styles.css, .xbar). */
const BAR = 54;
const number = (text: string | undefined): number | undefined => (text ? Number(text) : undefined);

export async function runStudent(): Promise<void> {
  const env = process.env;
  const flow = new StudentFlow({
    pc: env.EXAMMODE_PC ?? hostname().replace(/\.local$/, ''),
    examRoot: env.EXAMMODE_EXAM_ROOT ?? join(app.getPath('documents'), 'ExamMode'),
    // the minute Windows started: the same for every ExamMode until the computer restarts
    bootId: String(Math.round((Date.now() - uptime() * 1000) / 60_000)),
    discoveryPort: number(env.EXAMMODE_BEACON_PORT),
    teacherPort: number(env.EXAMMODE_PORT),
  });

  const main = createWindow('student', { width: 1440, height: 900, minWidth: 1280, minHeight: 720 });
  main.once('ready-to-show', () => main.show());
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
    askHandIn: () => flow.askHandIn(),
    keepWorking: () => flow.keepWorking(),
    handIn: () => flow.handIn(),
    finish: () => flow.finish(),
    showQuestions: () => browser?.window.show(),
    // M3: the computer isn't locked, so the Exam folder opens in the system's own file manager (its own list: M5)
    openFolder: () => {
      if (!flow.folder) return;
      mkdirSync(flow.folder, { recursive: true });
      return shell.openPath(flow.folder);
    },
  }, () => [main, bar]);

  /** The windows that go with a screen. */
  function arrange(state: StudentState): void {
    const inExam = state.screen === 'exam' || state.screen === 'handIn';
    const area = screen.getPrimaryDisplay().workArea;
    if (inExam && !bar) {
      bar = createWindow('bar', {
        x: area.x, y: area.y, width: area.width, height: BAR, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
        fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#0f172a', title: 'ExamMode — the exam bar',
      });
      bar.setAlwaysOnTop(true, 'screen-saver');
      bar.once('ready-to-show', () => bar?.showInactive());
    }
    if (inExam && !browser && flow.websites.length > 0) {
      browser = new ExamBrowser(flow.websites, { x: area.x, y: area.y + BAR, width: area.width, height: area.height - BAR }, {
        changed: (s) => tellBrowser(browserState = s),
        blocked: (url) => flow.report('pageBlocked', { url }),
      });
    }
    if (!inExam) {
      bar?.destroy();
      bar = undefined;
      browser?.destroy();
      browser = undefined;
    }
    if (state.screen === 'exam') return main.hide();
    // Hand in… comes up over whatever the student has open
    main.setAlwaysOnTop(state.screen === 'handIn', 'screen-saver');
    main.show();
    if (state.screen === 'handIn') main.focus();
  }

  let shown: StudentState['screen'] = 'join';
  flow.onState((state) => {
    tell(state);
    if (state.screen === shown) return;
    shown = state.screen;
    arrange(state);
  });
  app.on('before-quit', () => void flow.stop());
  await flow.start();
}
