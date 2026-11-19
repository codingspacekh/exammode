/**
 * ExamMode Guard, the program (architecture D3, §2.4): started with Windows as a service, it undoes any journal
 * left behind, then waits for ExamMode. Run as an administrator; as a service it is LocalSystem.
 *
 *   ExamModeGuard [--allow <ExamMode.exe>]… [--port <n>] [--journal <file>] [--no-relaunch] [--dev]
 *
 * `--allow`: the programs that may ask it to lock — the installed ExamMode.exe by default (D10).
 * `--no-relaunch`: for development, where ExamMode is Electron itself and can't be started by its program alone.
 * `--undo`: undo what the journal says and stop (`npm run unlock`): for a computer that stayed locked.
 * `--dev`: a development Guard also keeps the programs a caller names reachable through the firewall (GitHub's own
 * agent on its computers). The installed service is never started with it.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { planAsked } from '@domain/lockdown/plan';
import { onlySystem } from '@infrastructure/windows/acl';
import { imageOf, prepareProcesses } from '@infrastructure/windows/processes';
import { prepareSessions, startInUserSession } from '@infrastructure/windows/session';
import { ownerOfConnection } from '@infrastructure/windows/tcp';
import { WindowsSystem } from '@infrastructure/windows/system';
import { Guard } from '@application/guard/guard';
import { GUARD, serve } from '@infrastructure/guard/channel';
import { ERRORS, urlOf } from '@contracts/network/http';

const args = process.argv.slice(2);
const all = (flag: string): string[] => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]!] : []));
const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
const allowed = (all('--allow').length > 0 ? all('--allow') : [join(programFiles, 'ExamMode', 'ExamMode.exe')]).map((p) => p.toLowerCase());
const journal = all('--journal')[0] ?? join(process.env.ProgramData ?? 'C:\\ProgramData', 'ExamMode', 'journal.json');
const port = Number(all('--port')[0] ?? (typeof GUARD === 'object' ? GUARD.port : 0));
const say = (text: string): void => console.log(`${new Date().toISOString()} ${text}`);

mkdirSync(dirname(journal), { recursive: true });
// the journal's folder is the system's and the administrators' alone: what is in the journal is put back as the
// system. (A journal file named on the command line — a test's — is where it is.)
if (all('--journal').length === 0 && !(await onlySystem(dirname(journal)))) say(`the folder ${dirname(journal)} couldn't be closed to other accounts`);
await prepareProcesses();
const service = await prepareSessions();

const guard = new Guard({
  journal,
  system: new WindowsSystem(),
  // F-20: the teacher's laptop is told at once; a few tries, as its network may just be coming back
  report: async (watched, stopped) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const told = await fetch(urlOf(watched.teacher, 'stopped'), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(stopped), signal: AbortSignal.timeout(3000),
      }).then((r) => r.ok || r.status === ERRORS.notFound, () => false);
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
// `--undo` (`npm run unlock`, as an administrator): put the computer back from the journal, and nothing else —
// for a lab computer that stayed locked
if (args.includes('--undo')) {
  const left = (await guard.status()).changes;
  say(left === 0 ? (undone > 0 ? 'This computer is back as it was.' : 'Nothing to undo: this computer isn\'t locked.') : `${left} changes couldn't be undone. Start the computer again, and run this once more.`);
  process.exit(left === 0 ? 0 : 1);
}
// only ExamMode is heard: the process at the other end of the connection — as Windows says, not as the caller
// says — has to be one of the allowed programs
const owners = new Map<Socket, number | undefined>();
const server = await serve(guard, { host: '127.0.0.1', port }, (socket) => {
  const pid = owners.get(socket);
  const image = pid === undefined ? null : imageOf(pid);
  return pid !== undefined && image !== null && allowed.includes(image.toLowerCase()) ? { pid, image } : undefined;
}, (ask, caller) => planAsked(ask, { examMode: caller.image, guard: process.execPath, dev: args.includes('--dev') }));
// (looked up when the connection is made, before its first message is read)
server.prependListener('connection', (socket: Socket) => {
  socket.pause();
  void ownerOfConnection(socket.remotePort ?? 0, port).catch(() => undefined).then((pid) => {
    owners.set(socket, pid);
    socket.once('close', () => owners.delete(socket));
    socket.resume();
  });
});
say(`ExamMode Guard is ready${service ? ' (a service)' : ''}: port ${port}, journal ${journal}, for ${allowed.join(', ')}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    guard.stop();
    server.close(() => process.exit(0));
  });
}
