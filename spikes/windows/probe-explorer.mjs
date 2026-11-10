// D7 / F-07: stop Explorer (taskbar, Start, desktop) and start it again. Does Windows restart it by itself?
import { spawn } from 'node:child_process';
import * as w from './win32.mjs';

const WINLOGON = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';
const running = () => /explorer\.exe/i.test(w.run('tasklist.exe', ['/fi', 'imagename eq explorer.exe', '/nh']).out);
const tray = () => Boolean(w.FindWindowW('Shell_TrayWnd', null));
const kill = () => w.run('taskkill.exe', ['/f', '/im', 'explorer.exe']);
function autoRestart() {
  const q = w.run('reg.exe', ['query', WINLOGON, '/v', 'AutoRestartShell']);
  const m = /0x([0-9a-f]+)/i.exec(q.out);
  return m ? parseInt(m[1], 16) : null;
}
const setAutoRestart = (v) => w.run('reg.exe', ['add', WINLOGON, '/v', 'AutoRestartShell', '/t', 'REG_DWORD', '/d', String(v), '/f']);

const result = { before: { running: running(), tray: tray(), autoRestartShell: autoRestart() } };
const original = result.before.autoRestartShell;
try {
  if (result.before.running) {
    kill();
    await w.sleep(8000);
    result.killedWithAutoRestart = { cameBackBySelf: running(), tray: tray() };
  }
  setAutoRestart(0);
  if (running()) kill();
  await w.sleep(8000);
  result.killedWithAutoRestartOff = { stayedDown: !running(), tray: tray() };

  const t0 = performance.now();
  spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
  let up = false;
  while (!up && performance.now() - t0 < 20_000) { await w.sleep(100); up = tray(); }
  result.restart = { trayBack: up, ms: Math.round(performance.now() - t0) };
} catch (e) {
  result.error = String(e?.stack ?? e);
} finally {
  if (original === null) w.run('reg.exe', ['delete', WINLOGON, '/v', 'AutoRestartShell', '/f']);
  else setAutoRestart(original);
  if (!running()) spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
  await w.sleep(3000);
  result.after = { running: running(), tray: tray(), autoRestartShell: autoRestart(), restored: autoRestart() === original };
}
result.pass = Boolean(result.killedWithAutoRestartOff?.stayedDown && result.restart?.trayBack && result.after.restored);
w.report(result);
