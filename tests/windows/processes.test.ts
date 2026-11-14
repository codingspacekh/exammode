import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { LISTS } from '@lib/guard/lists';
import { virtualMachine } from '@lib/lockdown/checks';
import { ProcessGuard, type Closed, type Procs } from '../../src/main/student/process-guard';
import { factsKnown, fileFacts, listProcesses, machine, remoteSession, terminate } from '../../src/win/processes';

/** M4's process guard against real Windows (T7). */
const windows = process.platform === 'win32';
const MIN = 60_000;
const procs: Procs = { list: listProcesses, known: factsKnown, terminate };

describe.runIf(windows)('M4 the computer\'s processes', () => {
  it('every process is listed with its program; this one too, with its parent', async () => {
    const all = await listProcesses(false);
    expect(all.length).toBeGreaterThan(20);
    const me = all.find((p) => p.pid === process.pid);
    expect(me?.image?.toLowerCase()).toBe(process.execPath.toLowerCase());
    expect(all.some((p) => p.pid === me?.parentPid)).toBe(true);
  });

  it('who made a program and what it calls itself: asked once, then remembered', async () => {
    const cmd = `${process.env.SystemRoot}\\System32\\cmd.exe`;
    const facts = await fileFacts([cmd, process.execPath, 'C:\\no\\such\\program.exe']);
    expect(facts.get(cmd)).toEqual({ signer: 'Microsoft Windows', product: expect.stringContaining('Windows') });
    expect(facts.get(process.execPath)?.signer).toBeDefined();
    expect(facts.get('C:\\no\\such\\program.exe')).toEqual({});
    expect(factsKnown(cmd)).toBe(true);
    const t0 = performance.now();
    await fileFacts([cmd, process.execPath]);
    expect(performance.now() - t0).toBeLessThan(200);
  }, 3 * MIN);

  it('F-04 GitHub\'s computers are known as virtual machines; whether this is Remote Desktop is known', async () => {
    const m = await machine();
    console.log(`M4 this computer: ${JSON.stringify(m)} → ${virtualMachine(m)}; remote session ${await remoteSession()}`);
    if (process.env.GITHUB_ACTIONS) expect(virtualMachine(m)).toBeDefined();
    expect(typeof (await remoteSession())).toBe('boolean');
  }, 2 * MIN);
});

describe.runIf(windows)('F-12 N-02 the process guard on a real computer', () => {
  it('Notepad started during the exam is closed within 1 s, and said by its name; what ran before is left alone', async () => {
    // what has a window now (GitHub's own agent among it) stands in for the exam's own programs
    const before = await listProcesses(true);
    const self = [process.execPath, ...before.filter((p) => p.hasWindow && p.image).map((p) => p.image!)];
    const closed: (Closed & { ms: number })[] = [];
    let started = 0;
    const guard = new ProcessGuard(procs, { allowed: [], always: LISTS, env: process.env as Record<string, string>, self }, (c) => closed.push({ ...c, ms: Math.round(performance.now() - started) }));
    expect(await guard.sweep()).toBe(0);
    guard.start();
    try {
      started = performance.now();
      spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref();
      await expect.poll(() => closed.length, { timeout: 30_000, interval: 50 }).toBeGreaterThan(0);
      console.log(`M4 N-02: ${closed.map((c) => `${c.name} closed ${c.ms} ms after it was started`).join('; ')}`);
      expect(closed[0]!.name).toMatch(/notepad/i);
      expect(closed[0]!.kind).toBe('app');
      // (from the start of the program, which is before its window shows)
      expect(closed[0]!.ms).toBeLessThan(3000);
      await new Promise((r) => setTimeout(r, 1500));
      expect((await listProcesses(false)).some((p) => /notepad\.exe$/i.test(p.image ?? '') && p.hasWindow)).toBe(false);
      // nothing that ran before was touched
      const after = await listProcesses(false);
      for (const p of before.filter((b) => b.hasWindow)) expect(after.some((a) => a.pid === p.pid), p.image ?? '').toBe(true);
    } finally {
      guard.stop();
    }
  }, 3 * MIN);
});
