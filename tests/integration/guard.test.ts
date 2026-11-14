import { existsSync, readFileSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply, read, type Change, type SystemState } from '@lib/lockdown/journal';
import { plan } from '@lib/lockdown/plan';
import type { Stopped } from '@lib/protocol/messages';
import { alive, Guard, type GuardOptions, type System, type Watched } from '../../src/guard/guard';
import { GuardClient, serve } from '../../src/guard/pipe';
import { later, tempFolder } from './helpers';

/** A computer as plain data (the journal's own model), which can be told to fail. */
class FakeSystem implements System {
  failOn?: string;
  applied: string[] = [];
  constructor(public state: SystemState) {}
  async read(target: Pick<Change, 'kind' | 'target'>) {
    return read(this.state, target);
  }
  async apply(change: Change) {
    if (this.failOn && change.target.includes(this.failOn)) throw new Error(`can't change ${change.target}`);
    this.applied.push(`${change.kind} ${change.target}`);
    this.state = apply(this.state, change);
  }
}

/** A lab computer before an exam: its own settings, one of which the lockdown also sets. */
const before = (): SystemState => ({
  registry: {
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\AutoRestartShell': 1,
    'HKU\\S-1-5-21-1\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoRun': 1,
    'HKLM\\SOFTWARE\\School\\Setting': 'theirs',
  },
  firewall: { enabled: { domain: 'on', private: 'off', public: 'on' }, outbound: { domain: 'allow', private: 'allow', public: 'block' }, rules: { 'School: printers': { name: 'School: printers', protocol: 'tcp', remotePorts: [9100] } } },
  explorer: 'running',
});
const PLAN = plan({
  userSid: 'S-1-5-21-1', runId: 'run-1', examMode: 'C:\\Program Files\\ExamMode\\ExamMode.exe', guard: 'C:\\Program Files\\ExamMode\\ExamModeGuard.exe',
  teacher: { address: '10.0.0.2', port: 47800 }, websites: false, profiles: [],
});
const WATCHED: Watched = { pid: 4242, runId: 'run-1', token: 't-1', instanceId: 'i-1', pc: 'PC-07', teacher: { host: '10.0.0.2', port: 47800 } };

async function guard(over: Partial<GuardOptions> = {}) {
  const journal = join(await tempFolder(), 'journal.json');
  const system = new FakeSystem(before());
  const g = new Guard({ journal, system, now: () => 1_800_000_000_000, watchMs: 10, ...over });
  later(() => g.stop());
  return { g, system, journal, entries: () => (existsSync(journal) ? readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; target: string; before: unknown }) : []) };
}

describe('N-04 the Guard\'s journal: every change written down before it is made, and undone in reverse order', () => {
  it('lock makes the plan\'s changes; unlock leaves the computer exactly as it was', async () => {
    const { g, system, entries, journal } = await guard();
    expect(await g.status()).toEqual({ locked: false, changes: 0, watching: undefined });
    expect(await g.lock(PLAN, 's3cret')).toEqual({ ok: true });
    expect(system.state.explorer).toBe('stopped');
    expect(system.state.firewall.outbound).toEqual({ domain: 'block', private: 'block', public: 'block' });
    expect(system.state.firewall.enabled.private).toBe('on');
    expect(system.state.registry['HKU\\S-1-5-21-1\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\DisableTaskMgr']).toBe(1);
    // what was already as the plan wants it isn't touched, so it isn't undone either
    expect(entries().some((e) => e.target.endsWith('\\NoRun'))).toBe(false);
    expect(entries().some((e) => e.kind === 'firewallOutbound' && e.target === 'public')).toBe(false);
    expect(entries().find((e) => e.target.endsWith('AutoRestartShell'))?.before).toBe(1);
    expect((await g.status()).locked).toBe(true);

    expect(await g.unlock('s3cret')).toEqual({ ok: true });
    expect(system.state).toEqual(before());
    expect(existsSync(journal)).toBe(false);
    // the last change made is the first undone
    const made = system.applied.slice(0, system.applied.length / 2);
    expect(system.applied.slice(system.applied.length / 2)).toEqual([...made].reverse());
  });

  it('only who locked can unlock; a second lock is refused while one holds', async () => {
    const { g, system } = await guard();
    await g.lock(PLAN, 's3cret');
    expect(await g.unlock('guessed')).toEqual({ ok: false, why: 'secret' });
    expect(await g.lock(PLAN, 'another')).toEqual({ ok: false, why: 'locked' });
    expect(system.state.explorer).toBe('stopped');
    expect(g.watch(WATCHED, 'guessed')).toEqual({ ok: false, why: 'secret' });
    // unlocking a computer that isn't locked is nothing
    await g.unlock('s3cret');
    expect(await g.unlock('whatever')).toEqual({ ok: true });
  });

  it('a change that can\'t be made undoes the ones before it: the computer is never left half locked', async () => {
    const { g, system, journal } = await guard();
    system.failOn = 'AutoRestartShell';
    expect(await g.lock(PLAN, 's3cret')).toMatchObject({ ok: false, why: 'failed', detail: expect.stringContaining('AutoRestartShell') });
    expect({ ...system.state, registry: {} }).toEqual({ ...before(), registry: {} });
    expect(system.state.explorer).toBe('running');
    // the one that failed couldn't be put back either: it stays in the journal, and nothing else does
    expect(readFileSync(journal, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(await g.lock(PLAN, 's3cret')).toEqual({ ok: false, why: 'locked' });
    system.failOn = undefined;
    expect(await g.recover()).toBe(1);
    expect(system.state).toEqual(before());
    expect(existsSync(journal)).toBe(false);
    expect(await g.lock(PLAN, 's3cret')).toEqual({ ok: true });
  });

  it('the Guard undoes a journal left by a killed ExamMode: at its own start, which is every boot', async () => {
    const first = await guard();
    await first.g.lock(PLAN, 's3cret');
    // the power goes: a new Guard, with nothing in memory, finds the journal
    const again = new Guard({ journal: first.journal, system: first.system });
    const made = first.system.applied.length;
    expect(made).toBeGreaterThan(15);
    expect(await again.recover()).toBe(made);
    expect(first.system.state).toEqual(before());
    expect(existsSync(first.journal)).toBe(false);
    expect(await again.recover()).toBe(0);
  });

  it('a journal entry cut short by a crash was never made, and isn\'t undone', async () => {
    const { g, system, journal } = await guard();
    await g.lock(PLAN.slice(0, 3), 's3cret');
    await appendFile(journal, '{"id":4,"kind":"registry","target":"HKLM\\\\SOFTWARE\\\\School\\\\Setting","before":"the');
    expect(await new Guard({ journal, system }).recover()).toBe(3);
    expect(system.state).toEqual(before());
  });

  it('a change that can\'t be undone now stays in the journal for the next try; the others are still undone', async () => {
    const { g, system, entries } = await guard();
    await g.lock(PLAN, 's3cret');
    system.failOn = 'DisableTaskMgr';
    expect(await g.unlock('s3cret')).toMatchObject({ ok: false, why: 'failed', detail: '1 changes couldn\'t be undone yet' });
    expect(system.state.explorer).toBe('running');
    expect(entries().map((e) => e.target.split('\\').at(-1))).toEqual(['DisableTaskMgr']);
    system.failOn = undefined;
    expect(await g.recover()).toBe(1);
    expect(system.state).toEqual(before());
  });

  it('a journal that is nonsense is taken as empty', async () => {
    const { g, journal } = await guard();
    await writeFile(journal, 'not a journal\n');
    expect(await g.status()).toMatchObject({ locked: false });
  });
});

describe('F-20 the watchdog: ExamMode\'s process ends without unlocking', () => {
  it('the teacher is told with the attempt\'s token, the computer is put back, and ExamMode is started again', async () => {
    const running = new Set([4242]);
    const told: Stopped[] = [];
    const relaunched: string[] = [];
    const { g, system } = await guard({
      alive: (pid) => running.has(pid),
      report: async (_w, stopped) => void told.push(stopped),
      relaunch: async (runId) => void relaunched.push(runId),
    });
    await g.lock(PLAN, 's3cret');
    expect(g.watch(WATCHED, 's3cret')).toEqual({ ok: true });
    expect((await g.status()).watching).toBe(4242);
    await g.look();
    expect(told).toEqual([]);

    running.delete(4242);
    await g.look();
    expect(told).toEqual([{ v: 1, type: 'stopped', token: 't-1', pc: 'PC-07', instanceId: 'i-1', at: 1_800_000_000_000 }]);
    expect(system.state).toEqual(before());
    expect(relaunched).toEqual(['run-1']);
    // once
    await g.look();
    expect(told).toHaveLength(1);
    expect((await g.status()).watching).toBeUndefined();
  });

  it('the computer is put back even if the teacher\'s laptop can\'t be told, or ExamMode can\'t be started', async () => {
    const { g, system } = await guard({
      alive: () => false,
      report: async () => { throw new Error('no network'); },
      relaunch: async () => { throw new Error('no session'); },
    });
    await g.lock(PLAN, 's3cret');
    g.watch(WATCHED, 's3cret');
    await g.look();
    expect(system.state).toEqual(before());
  });

  it('the watchdog looks by itself; after an unlock there is nothing to watch', async () => {
    const running = new Set([4242]);
    let told = 0;
    const { g, system } = await guard({ alive: (pid) => running.has(pid), report: async () => void told++ });
    await g.lock(PLAN, 's3cret');
    g.watch(WATCHED, 's3cret');
    running.delete(4242);
    await expect.poll(() => told).toBe(1);
    await expect.poll(() => system.state.explorer).toBe('running');

    await g.lock(PLAN, 'again');
    g.watch(WATCHED, 'again');
    await g.unlock('again');
    await new Promise((r) => setTimeout(r, 50));
    expect(told).toBe(1);
  });

  it('a process is known to be running or gone', () => {
    expect(alive(process.pid)).toBe(true);
    expect(alive(2_000_000_000)).toBe(false);
  });
});

describe('§2.4 ExamMode and the Guard talk', () => {
  async function piped(isExamMode = (pid: number) => pid === 4242) {
    const made = await guard({ alive: () => true });
    // (a Unix socket stands in for the Windows pipe)
    const path = process.platform === 'win32' ? `\\\\.\\pipe\\exammode-test-${process.pid}-${Date.now()}` : join(await tempFolder(), 'guard.sock');
    const server = await serve(made.g, path, isExamMode);
    later(() => new Promise<void>((r) => server.close(() => r())));
    return { ...made, path, client: new GuardClient(path, 4242) };
  }

  it('on a port that only this computer can reach', async () => {
    const made = await guard();
    const server = await serve(made.g, { host: '127.0.0.1', port: 0 }, () => true);
    later(() => new Promise<void>((r) => server.close(() => r())));
    const { port, address } = server.address() as { port: number; address: string };
    expect(address).toBe('127.0.0.1');
    expect(await new GuardClient({ host: '127.0.0.1', port }, 1).ask({ type: 'status' })).toMatchObject({ ok: true, locked: false });
  });

  it('lock, status, watch and unlock go over it', async () => {
    const { client, system } = await piped();
    expect(await client.ask({ type: 'status' })).toEqual({ id: 1, ok: true, locked: false, changes: 0 });
    expect(await client.ask({ type: 'lock', plan: PLAN, secret: 's3cret' })).toEqual({ id: 2, ok: true });
    expect(system.state.explorer).toBe('stopped');
    expect(await client.ask({ type: 'watch', secret: 's3cret', runId: 'run-1', token: 't-1', instanceId: 'i-1', pc: 'PC-07', teacher: { host: '10.0.0.2', port: 47800 } })).toEqual({ id: 3, ok: true });
    expect(await client.ask({ type: 'status' })).toMatchObject({ locked: true, watching: 4242 });
    expect(await client.ask({ type: 'unlock', secret: 'guessed' })).toEqual({ id: 5, ok: false, why: 'secret' });
    expect(await client.ask({ type: 'unlock', secret: 's3cret' })).toEqual({ id: 6, ok: true });
    expect(system.state).toEqual(before());
  });

  it('a program that isn\'t ExamMode is not heard', async () => {
    const { path, system } = await piped();
    const stranger = new GuardClient(path, 999);
    expect(await stranger.ask({ type: 'lock', plan: PLAN, secret: 'mine' })).toEqual({ id: 1, ok: false, why: 'notExamMode' });
    expect(await stranger.ask({ type: 'unlock', secret: 'mine' })).toMatchObject({ ok: false, why: 'notExamMode' });
    expect(system.applied).toEqual([]);
  });

  it('what isn\'t a message is refused, and a plan is checked before anything is done', async () => {
    const { client, system, path } = await piped();
    const bad = [{ kind: 'registry', target: 'HKLM\\X', after: 1 }, { kind: 'format', target: 'C:', after: 'now' }] as unknown as Change[];
    expect(await client.ask({ type: 'lock', plan: bad, secret: 's' })).toMatchObject({ ok: false, why: 'invalid' });
    expect(system.applied).toEqual([]);
    const { createConnection } = await import('node:net');
    const raw = await new Promise<string>((resolve) => {
      const socket = createConnection(path, () => socket.write('not json\n'));
      socket.once('data', (data) => { resolve(String(data)); socket.destroy(); });
    });
    expect(JSON.parse(raw)).toEqual({ id: 0, ok: false, why: 'invalid' });
  });

  it('ExamMode is told when the Guard isn\'t there', async () => {
    const path = process.platform === 'win32' ? '\\\\.\\pipe\\exammode-nobody' : join(await tempFolder(), 'nobody.sock');
    await expect(new GuardClient(path, 1).ask({ type: 'status' })).rejects.toThrow();
  });
});
