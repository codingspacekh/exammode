import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Change } from '@lib/lockdown/journal';
import { plan } from '@lib/lockdown/plan';
import type { Stopped } from '@lib/protocol/messages';
import { Guard } from '../../src/guard/guard';
import { explorerRunning } from '../../src/win/explorer';
import { Firewall } from '../../src/win/firewall';
import { readValue, writeValue } from '../../src/win/registry';
import { powershellJson, run } from '../../src/win/run';
import { WindowsSystem } from '../../src/win/system';

/**
 * M4's executors against real Windows (T6, T7): GitHub's Windows runners, as administrator, and a lab computer at
 * the gate. Every test leaves the machine as it found it.
 */
const MIN = 60_000;
const windows = process.platform === 'win32';
const TEST_KEY = 'Software\\ExamModeTest';

describe.runIf(windows)('M4 the registry', () => {
  afterAll(async () => {
    await run('reg.exe', ['delete', `HKCU\\${TEST_KEY}`, '/f']);
    await run('reg.exe', ['delete', `HKLM\\SOFTWARE\\ExamModeTest`, '/f']);
  });

  it('a value that isn\'t there is null; a number and a text are written, read and deleted', async () => {
    const number = `HKCU\\${TEST_KEY}\\Policies\\DisableTaskMgr`;
    const text = `HKCU\\${TEST_KEY}\\Run\\Exam Mode`;
    expect(await readValue(number)).toBeNull();
    await writeValue(number, 1);
    expect(await readValue(number)).toBe(1);
    await writeValue(number, 0);
    expect(await readValue(number)).toBe(0);
    await writeValue(text, '"C:\\Program Files\\ExamMode\\ExamMode.exe" --resume run-1');
    expect(await readValue(text)).toBe('"C:\\Program Files\\ExamMode\\ExamMode.exe" --resume run-1');
    await writeValue(number, null);
    await writeValue(text, null);
    await writeValue(text, null);
    expect(await readValue(number)).toBeNull();
    expect(await readValue(text)).toBeNull();
  });

  it('the machine\'s values too (as administrator)', async () => {
    const target = 'HKLM\\SOFTWARE\\ExamModeTest\\AllowClipboardHistory';
    await writeValue(target, 0);
    expect(await readValue(target)).toBe(0);
    await writeValue(target, null);
    expect(await readValue(target)).toBeNull();
  });
});

describe.runIf(windows)('M4 the firewall', () => {
  const firewall = new Firewall();
  const rule = { name: 'ExamMode test: the teacher', program: '%SystemRoot%\\System32\\curl.exe', protocol: 'tcp' as const, remoteAddress: '10.0.0.2', remotePorts: [47800] };
  afterAll(() => firewall.deleteRule(rule.name));

  it('each profile says whether it is on and what it does with outbound traffic', async () => {
    for (const name of ['domain', 'private', 'public'] as const) {
      const profile = await firewall.profile(name);
      expect(['on', 'off']).toContain(profile.state);
      expect(['allow', 'block']).toContain(profile.outbound);
    }
  }, 2 * MIN);

  it('a rule of ours is made, found by its name, and removed', async () => {
    expect(await firewall.hasRule(rule.name)).toBe(false);
    await firewall.addRule(rule);
    await firewall.addRule(rule);
    expect(await firewall.hasRule(rule.name)).toBe(true);
    const shown = await run('netsh.exe', ['advfirewall', 'firewall', 'show', 'rule', `name=${rule.name}`]);
    // made once, though it was added twice
    expect(shown.out.match(/ExamMode test: the teacher/g)).toHaveLength(1);
    expect(shown.out).toContain('47800');
    await firewall.deleteRule(rule.name);
    await firewall.deleteRule(rule.name);
    expect(await firewall.hasRule(rule.name)).toBe(false);
  }, 2 * MIN);
});

describe.runIf(windows)('M4 locking a real computer and putting it back (N-04, F-21, F-23)', () => {
  const system = new WindowsSystem();
  let folder: string;
  let changes: Change[];

  /** Can this program reach the internet? The answer is its HTTP status, 000 when it can't. */
  const curl = async () => (await run('curl.exe', ['-s', '-m', '8', '-o', 'NUL', '-w', '%{http_code}', 'https://example.com'])).out || '000';
  const node = async () => (await run(process.execPath, ['-e', "fetch('https://example.com',{signal:AbortSignal.timeout(8000)}).then(r=>console.log(r.status)).catch(()=>console.log('000'))"])).out || '000';
  const reaches = (code: string) => /^[23]\d\d$/.test(code);
  /** Everything the plan touches, as it is now. */
  const snapshot = async () => Object.fromEntries(await Promise.all(changes.filter((c) => c.kind !== 'firewallRule').map(async (c) => [`${c.kind} ${c.target}`, await system.read(c)] as const)));

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'exammode-guard-'));
    const sid = /"(S-1-[\d-]+)"/.exec((await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'])).out)?.[1];
    if (!sid) throw new Error('This account\'s SID can\'t be read');
    // "ExamMode" is this Node: the one program that may reach the exam's websites
    changes = plan({ userSid: sid, runId: 'run-1', examMode: process.execPath, guard: process.execPath, teacher: { address: '10.0.0.2', port: 47800 }, websites: true, profiles: [] });
    if (process.env.GITHUB_ACTIONS) {
      // GitHub's own runner has to stay reachable while this computer is locked
      const runners = await powershellJson<{ Name: string; Path: string }[] | { Name: string; Path: string }>('Get-Process Runner.* -ErrorAction SilentlyContinue | Select-Object Name,Path');
      const extra = [runners ?? []].flat().filter((r) => r.Path).map((r): Change => ({ kind: 'firewallRule', target: `ExamMode test: ${r.Name}`, after: { name: `ExamMode test: ${r.Name}`, program: r.Path, protocol: 'tcp' } }));
      const at = changes.findIndex((c) => c.kind === 'firewallState');
      changes = [...changes.slice(0, at), ...extra, ...changes.slice(at)];
    }
  }, 2 * MIN);
  afterAll(async () => {
    // whatever a failed test left behind
    await new Guard({ journal: join(folder, 'journal.json'), system }).recover();
    await rm(folder, { recursive: true, force: true });
  }, 3 * MIN);

  it('F-21 after unlock, the firewall, the policies and Explorer are as before; while locked, only ExamMode reaches the internet', async () => {
    const journal = join(folder, 'journal.json');
    const guard = new Guard({ journal, system });
    const before = await snapshot();
    expect(reaches(await curl())).toBe(true);

    const t0 = performance.now();
    expect(await guard.lock(changes, 's3cret')).toEqual({ ok: true });
    const lockMs = Math.round(performance.now() - t0);
    const locked = await snapshot();
    expect(Object.entries(locked).filter(([k]) => k.startsWith('firewall')).map(([, v]) => v)).toEqual(['on', 'on', 'on', 'block', 'block', 'block']);
    expect(locked['explorer shell']).toBe('stopped');
    expect(await explorerRunning()).toBe(false);
    expect(Object.entries(locked).find(([k]) => k.endsWith('\\DisableTaskMgr'))?.[1]).toBe(1);
    expect(Object.entries(locked).find(([k]) => k.endsWith('\\Run\\ExamMode'))?.[1]).toContain('--resume run-1');
    // F-23: a program other than ExamMode can't reach the internet; ExamMode can, as the exam has websites
    expect(reaches(await curl())).toBe(false);
    expect(reaches(await node())).toBe(true);

    const t1 = performance.now();
    expect(await guard.unlock('s3cret')).toEqual({ ok: true });
    console.log(`M4 on ${process.env.RUNNER_OS ?? 'this computer'}: lock ${lockMs} ms, unlock ${Math.round(performance.now() - t1)} ms, ${changes.length} changes`);
    expect(await snapshot()).toEqual(before);
    expect(existsSync(journal)).toBe(false);
    expect(await new Firewall().hasRule('ExamMode: the teacher')).toBe(false);
    expect(reaches(await curl())).toBe(true);
  }, 6 * MIN);

  it('N-04 the Guard undoes a journal left by a killed ExamMode, at its next start', async () => {
    const journal = join(folder, 'journal.json');
    const before = await snapshot();
    expect(await new Guard({ journal, system }).lock(changes, 's3cret')).toEqual({ ok: true });
    expect(await explorerRunning()).toBe(false);
    // a new Guard, as after a restart: it knows nothing but the journal
    expect(await new Guard({ journal, system }).recover()).toBeGreaterThan(10);
    expect(await snapshot()).toEqual(before);
    expect(await explorerRunning()).toBe(true);
  }, 6 * MIN);

  it('F-20 ExamMode\'s process is killed: the Guard tells the teacher and puts the computer back', async () => {
    const journal = join(folder, 'journal.json');
    const before = await snapshot();
    const told: Stopped[] = [];
    const guard = new Guard({ journal, system, watchMs: 200, report: async (_w, stopped) => void told.push(stopped) });
    // a program that stands in for ExamMode
    const examMode = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      expect(await guard.lock(changes, 's3cret')).toEqual({ ok: true });
      expect(guard.watch({ pid: examMode.pid!, runId: 'run-1', token: 't-1', instanceId: 'i-1', pc: 'PC-07', teacher: { host: '10.0.0.2', port: 47800 } }, 's3cret')).toEqual({ ok: true });
      await new Promise((r) => setTimeout(r, 1000));
      expect(told).toEqual([]);
      await run('taskkill.exe', ['/f', '/pid', String(examMode.pid)]);
      await expect.poll(() => told.length, { timeout: 30_000 }).toBe(1);
      expect(told[0]).toMatchObject({ type: 'stopped', token: 't-1', instanceId: 'i-1', pc: 'PC-07' });
      await expect.poll(() => existsSync(journal), { timeout: 2 * MIN, interval: 500 }).toBe(false);
      expect(await snapshot()).toEqual(before);
    } finally {
      guard.stop();
      examMode.kill();
    }
  }, 6 * MIN);
});
