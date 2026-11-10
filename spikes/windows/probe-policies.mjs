// §2.4: does the user policy DisableTaskMgr take effect at once (no sign-out)? Put back as it was.
import { spawn } from 'node:child_process';
import * as w from './win32.mjs';

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';
function taskManagerOpens() {
  return new Promise((resolve) => {
    spawn('taskmgr.exe', [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => {
      const open = Boolean(w.FindWindowW('TaskManagerWindow', null));
      w.run('taskkill.exe', ['/f', '/im', 'taskmgr.exe']);
      resolve(open);
    }, 3500);
  });
}
const before = w.run('reg.exe', ['query', KEY, '/v', 'DisableTaskMgr']);
const original = before.ok ? parseInt(/0x([0-9a-f]+)/i.exec(before.out)?.[1] ?? '0', 16) : null;
const result = { hadValue: before.ok, original };
try {
  result.withoutPolicy = await taskManagerOpens();
  w.run('reg.exe', ['add', KEY, '/v', 'DisableTaskMgr', '/t', 'REG_DWORD', '/d', '1', '/f']);
  await w.sleep(500);
  result.withPolicy = await taskManagerOpens();
} catch (e) {
  result.error = String(e?.stack ?? e);
} finally {
  if (original === null) w.run('reg.exe', ['delete', KEY, '/v', 'DisableTaskMgr', '/f']);
  else w.run('reg.exe', ['add', KEY, '/v', 'DisableTaskMgr', '/t', 'REG_DWORD', '/d', String(original), '/f']);
  const after = w.run('reg.exe', ['query', KEY, '/v', 'DisableTaskMgr']);
  const now = after.ok ? parseInt(/0x([0-9a-f]+)/i.exec(after.out)?.[1] ?? '0', 16) : null;
  result.restored = now === original;
}
result.pass = result.withoutPolicy === true && result.withPolicy === false && result.restored;
w.report(result);
