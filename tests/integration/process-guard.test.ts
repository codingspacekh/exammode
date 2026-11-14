import { describe, expect, it } from 'vitest';
import { LISTS } from '@lib/guard/lists';
import type { AppProfile } from '@lib/profiles/schema';
import { ProcessGuard, type Closed, type Proc, type Procs } from '../../src/main/student/process-guard';
import { word } from '../fixtures/profiles';

/** A computer's processes that the test starts and that the guard closes. */
class FakeProcs implements Procs {
  running: Proc[] = [];
  facts = new Map<string, { signer?: string; product?: string }>();
  asked = 0;
  stubborn = new Set<number>();
  private readonly seen = new Set<string>();
  start(pid: number, image: string, facts: { signer?: string; product?: string } = {}, over: Partial<Proc> = {}) {
    this.facts.set(image, facts);
    this.running.push({ pid, parentPid: 1, image, hasWindow: true, titles: ['a window'], ...over });
  }
  async list(withFacts: boolean): Promise<Proc[]> {
    if (withFacts) {
      this.asked++;
      for (const p of this.running) if (p.image) this.seen.add(p.image);
    }
    return this.running.map((p) => ({ ...p, ...(p.image && this.seen.has(p.image) ? this.facts.get(p.image) : {}) }));
  }
  known(image: string) {
    return this.seen.has(image);
  }
  async terminate(pid: number) {
    if (this.stubborn.has(pid)) return false;
    this.running = this.running.filter((p) => p.pid !== pid);
    return true;
  }
}

const EXAM_MODE = 'C:\\Program Files\\ExamMode\\ExamMode.exe';
const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' };
const WORD = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE';

function guard(allowed: AppProfile[] = []) {
  const procs = new FakeProcs();
  const closed: Closed[] = [];
  const g = new ProcessGuard(procs, { allowed, always: LISTS, env, self: [EXAM_MODE] }, (c) => closed.push(c), () => 1_800_000_000_000);
  procs.start(4, 'C:\\Windows\\System32\\dwm.exe', { signer: 'Microsoft Windows' });
  procs.start(100, EXAM_MODE, { signer: 'CodingSpaceKH' });
  return { g, procs, closed, pids: () => procs.running.map((p) => p.pid) };
}

describe('F-12 N-02 the process guard\'s loop', () => {
  it('an app that isn\'t part of the exam is closed at the next look, and said by its name', async () => {
    const { g, procs, closed, pids } = guard();
    expect(await g.sweep()).toBe(0);
    procs.start(200, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', { signer: 'Google LLC', product: 'Google Chrome' });
    expect(await g.sweep()).toBe(1);
    expect(pids()).toEqual([4, 100]);
    expect(closed).toEqual([{ name: 'chrome', kind: 'browser', pid: 200, at: 1_800_000_000_000 }]);
    expect(await g.sweep()).toBe(0);
  });

  it('N-02 a program that no publisher could make allowed is closed without waiting to ask who made it', async () => {
    const { g, procs } = guard([word]);
    await g.sweep();
    const asked = procs.asked;
    procs.start(300, 'C:\\Users\\lab\\Downloads\\cheat.exe');
    expect(await g.sweep()).toBe(1);
    expect(procs.asked).toBe(asked);
  });

  it('an allowed app is never closed by guess: who made it is asked first, and then it stays', async () => {
    const { g, procs, pids } = guard([word]);
    procs.start(400, WORD, { signer: 'Microsoft Corporation', product: 'Microsoft Office' });
    expect(await g.sweep()).toBe(0);
    expect(pids()).toContain(400);
    expect(procs.asked).toBe(1);
    // … and a copy of something else put in Word's place, under Word's name, is closed once it is known
    procs.running = procs.running.filter((p) => p.pid !== 400);
    const { g: g2, procs: p2, closed } = guard([word]);
    p2.start(401, WORD, { signer: 'Nobody Ltd' });
    expect(await g2.sweep()).toBe(1);
    expect(closed[0]).toMatchObject({ name: 'WINWORD', kind: 'app' });
  });

  it('a remote-control tool is closed even with no window; other programs in the background are left', async () => {
    const { g, procs, closed, pids } = guard();
    procs.start(500, 'C:\\Program Files\\AnyDesk\\AnyDesk.exe', { product: 'AnyDesk' }, { hasWindow: false, titles: [] });
    procs.start(501, 'C:\\Program Files\\Updater\\updater.exe', {}, { hasWindow: false, titles: [] });
    expect(await g.sweep()).toBe(1);
    expect(closed[0]).toMatchObject({ name: 'AnyDesk', kind: 'remote' });
    expect(pids()).toContain(501);
  });

  it('a program that can\'t be closed isn\'t said to be, and isn\'t tried every half second', async () => {
    const { g, procs, closed } = guard();
    procs.start(600, 'C:\\Users\\lab\\stubborn.exe');
    procs.stubborn.add(600);
    expect(await g.sweep()).toBe(0);
    expect(await g.sweep()).toBe(0);
    expect(closed).toEqual([]);
  });

  it('the loop looks by itself until it is stopped', async () => {
    const { g, procs, closed } = guard();
    g.start(10);
    procs.start(700, 'C:\\Users\\lab\\game.exe');
    await expect.poll(() => closed.length).toBe(1);
    g.stop();
    procs.start(701, 'C:\\Users\\lab\\game.exe');
    await new Promise((r) => setTimeout(r, 40));
    expect(closed).toHaveLength(1);
  });
});
