/**
 * ExamMode Guard, the program (architecture D3, §2.4): started with Windows as a service, it undoes any journal
 * left behind, then waits for ExamMode. Run as an administrator; as a service it is LocalSystem.
 *
 *   ExamModeGuard [--allow <ExamMode.exe>]… [--port <n>] [--journal <file>] [--no-relaunch]
 *
 * `--allow`: the programs that may ask it to lock — the installed ExamMode.exe by default (D10).
 * `--no-relaunch`: for development, where ExamMode is Electron itself and can't be started by its program alone.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { imageOf, prepareProcesses } from '../win/processes';
import { prepareSessions, startInUserSession } from '../win/session';
import { WindowsSystem } from '../win/system';
import { Guard } from './guard';
import { GUARD, serve } from './pipe';

const args = process.argv.slice(2);
const all = (flag: string): string[] => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]!] : []));
const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
const allowed = (all('--allow').length > 0 ? all('--allow') : [join(programFiles, 'ExamMode', 'ExamMode.exe')]).map((p) => p.toLowerCase());
const journal = all('--journal')[0] ?? join(process.env.ProgramData ?? 'C:\\ProgramData', 'ExamMode', 'journal.json');
const port = Number(all('--port')[0] ?? (typeof GUARD === 'object' ? GUARD.port : 0));
const say = (text: string): void => console.log(`${new Date().toISOString()} ${text}`);

mkdirSync(dirname(journal), { recursive: true });
await prepareProcesses();
const service = await prepareSessions();

const guard = new Guard({
  journal,
  system: new WindowsSystem(),
  // F-20: the teacher's laptop is told at once; a few tries, as its network may just be coming back
  report: async (watched, stopped) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const told = await fetch(`http://${watched.teacher.host}:${watched.teacher.port}/stopped`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(stopped), signal: AbortSignal.timeout(3000),
      }).then((r) => r.ok || r.status === 404, () => false);
      if (told) return;
    }
    say(`the teacher's laptop couldn't be told that ExamMode stopped on ${watched.pc}`);
  },
  // … and ExamMode is started again, to say why this student is locked out (screen 10)
  relaunch: async (runId) => {
    if (args.includes('--no-relaunch')) return;
    const exe = allowed[0]!;
    const line = `"${exe}" --resume ${runId}`;
    if (!startInUserSession(line)) spawn(exe, ['--resume', runId], { detached: true, stdio: 'ignore' }).unref();
  },
});

const undone = await guard.recover();
if (undone > 0) say(`${undone} changes of an exam that didn't end were undone`);
// only ExamMode is heard: the program a caller says it is has to be one of the allowed ones
const server = await serve(guard, { host: '127.0.0.1', port }, (pid) => {
  const image = imageOf(pid);
  return image !== null && allowed.includes(image.toLowerCase());
});
say(`ExamMode Guard is ready${service ? ' (a service)' : ''}: port ${port}, journal ${journal}, for ${allowed.join(', ')}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    guard.stop();
    server.close(() => process.exit(0));
  });
}
