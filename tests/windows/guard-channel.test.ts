import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GuardClient } from '../../src/guard/pipe';
import { onlySystem } from '../../src/win/acl';
import { run } from '../../src/win/run';
import { ownerOfConnection } from '../../src/win/tcp';

/** The Guard's channel on a real Windows: who is really calling, and a journal folder nobody else can write. */
const home = mkdtempSync(join(tmpdir(), 'exammode-channel-'));
const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children) child.kill();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const freePort = (): Promise<number> => new Promise((resolve) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    server.close(() => resolve(port));
  });
});

/** A Guard that hears only `allow`, started as `npm run guard` would be. */
async function guardFor(allow: string): Promise<number> {
  const port = await freePort();
  const child = spawn(process.execPath, [join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/guard/main.ts', '--allow', allow, '--port', String(port), '--journal', join(home, `journal-${port}.json`), '--no-relaunch'], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`The Guard stopped (${code})`)));
    child.stdout!.on('data', (data) => String(data).includes('is ready') && resolve());
  });
  return port;
}

describe('§2.4 the Guard knows who is calling', () => {
  it('Windows says which process owns a connection on this computer', async () => {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const socket = connect(port, '127.0.0.1');
    await new Promise((r) => socket.once('connect', r));
    expect(await ownerOfConnection(socket.localPort!, port)).toBe(process.pid);
    expect(await ownerOfConnection(1, port)).toBeUndefined();
    socket.destroy();
    server.close();
  });

  it('a program that says it is ExamMode — with ExamMode\'s own process number — is not heard', async () => {
    // "ExamMode" here is Notepad, and it is running
    const notepad = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe');
    const real = spawn(notepad, [], { stdio: 'ignore' });
    children.push(real);
    await new Promise((r) => setTimeout(r, 1500));
    const port = await guardFor(notepad);
    // this test isn't Notepad, whatever it says
    const liar = new GuardClient({ host: '127.0.0.1', port }, real.pid);
    expect(await liar.ask({ type: 'status' })).toMatchObject({ ok: false, why: 'notExamMode' });
    expect(await liar.ask({ type: 'unlock', secret: 'x' })).toMatchObject({ ok: false, why: 'notExamMode' });
  }, 60_000);

  it('the program the Guard is for is heard, whatever number it gives', async () => {
    // "ExamMode" here is this test's own program (node)
    const port = await guardFor(process.execPath);
    expect(await new GuardClient({ host: '127.0.0.1', port }, 1).ask({ type: 'status' })).toMatchObject({ ok: true, locked: false });
  }, 60_000);
});

describe('§2.4 the journal\'s folder', () => {
  it('is the system\'s and the administrators\' alone: no other account can put a journal there', async () => {
    const folder = mkdtempSync(join(home, 'journal-'));
    expect(await onlySystem(folder)).toBe(true);
    const acl = (await run('icacls.exe', [folder])).out;
    console.log(`[acl] ${acl.replace(/\s+/g, ' ').trim()}`);
    expect(acl).toMatch(/NT AUTHORITY\\SYSTEM:\(OI\)\(CI\)\(F\)/);
    expect(acl).toMatch(/BUILTIN\\Administrators:\(OI\)\(CI\)\(F\)/);
    expect(acl).not.toMatch(/Users|Everyone|INTERACTIVE/);
  });
});
