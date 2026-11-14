import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExamForm, TeacherState } from '@lib/app/state';
import type { FromStudent } from '@lib/protocol/messages';
import type { Classroom } from '../../src/main/teacher/classroom';
import { TeacherDesk } from '../../src/main/teacher/desk';
import type { Store } from '../../src/main/teacher/store/store';
import { tempFolder } from '../integration/helpers';

/**
 * N-03, with room to grow: the teacher's laptop with 100 students in one exam, a lab's worth of installed-app
 * reports, and a log as long as a day of exams — while every student's computer says something several times a
 * second. What is measured is the desk: how long bringing the screens up to date takes, how often it is done,
 * and how much is sent to them.
 */
let desk: TeacherDesk | undefined;
afterEach(async () => {
  await desk?.close();
  desk = undefined;
});

const STUDENTS = 100;
const names = Array.from({ length: STUDENTS }, (_, i) => `Student ${String(i + 1).padStart(3, '0')}`);
const FORM: ExamForm = { teacher: 'Ms Srey Leak', title: 'Year 10 ICT — Term 1 practical exam', className: 'Year 10', studentNames: names.join('\n'), minutes: 90, websites: [] };
const v = 1;

describe('N-03 the teacher\'s laptop under load', () => {
  it('100 students, 40 computers\' apps, a 20,000-event log: the screens are brought up to date in milliseconds, a few times a second', async () => {
    const root = await tempFolder();
    desk = await TeacherDesk.open({ db: join(root, 'exammode.db'), handIns: join(root, 'Hand-ins'), port: 0, tickMs: 0, beacon: { everyMs: 60_000, targets: () => [] } });
    const store = desk['store'] as Store;
    const app = (i: number) => ({ name: `App ${i}`, publisher: 'Someone', version: '1.0', exe: `C:\\Program Files\\App ${i}\\app${i}.exe` });
    for (let pc = 0; pc < 40; pc++) await store.saveInventory(`PC-${pc}`, { profiles: ['word', 'excel'], apps: Array.from({ length: 300 }, (_, i) => app(i)) }, 1);
    expect(await desk.openExam(FORM)).toBeUndefined();
    const room = desk['room'] as Classroom;
    const code = desk.state().run!.code;
    const students = desk.state().students;
    const links = students.map((_, i) => ({ send: () => undefined, close: () => undefined, from: `10.0.${Math.floor(i / 250)}.${i % 250}` }));
    const say = (i: number, msg: Record<string, unknown>) => room.receive(links[i]!, { v, ...msg } as FromStudent);
    for (const [i, s] of students.entries()) {
      await say(i, { type: 'join', runId: room.id, studentId: s.id, code, pc: `PC-${i}`, instanceId: `i-${i}`, bootId: 'b' });
      await say(i, { type: 'checks', results: [{ check: 'oneScreen', ok: true }] });
      await say(i, { type: 'ready' });
    }
    await desk.start();
    // a day's log is already there
    for (let batch = 0; batch < 20; batch++) {
      await store.log(room.id, Array.from({ length: 1000 }, (_, i) => ({ studentId: students[i % STUDENTS]!.id, pc: `PC-${i % STUDENTS}`, at: 1000 + i, kind: 'pageBlocked', details: { url: `https://example.com/${batch}/${i}` } })));
    }
    await desk['refresh']();

    // measured from here: how long each look takes, how many there are, how much goes to the screens
    const builds: number[] = [];
    const build = desk['build'].bind(desk);
    desk['build'] = async () => {
      const from = performance.now();
      const state = await build();
      builds.push(performance.now() - from);
      return state;
    };
    let pushes = 0;
    let last: TeacherState | undefined;
    desk.onState((state) => {
      pushes++;
      last = state;
    });

    // three seconds of a busy room: every student's front window changes, and now and then an app is closed
    const from = performance.now();
    let sent = 0;
    while (performance.now() - from < 3000) {
      for (let i = 0; i < STUDENTS; i++) {
        void say(i, { type: 'beat', seq: sent, front: `Word · Report ${sent}.docx` });
        if ((sent + i) % 50 === 0) void say(i, { type: 'event', kind: 'appClosed', details: { app: 'Notepad' } });
      }
      sent++;
      await new Promise((r) => setTimeout(r, 20));
    }
    await desk['refresh']();
    const seconds = (performance.now() - from) / 1000;
    const sorted = [...builds].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    const bytes = JSON.stringify(last).length;
    console.log(`[load] ${STUDENTS} students, ${sent * STUDENTS} beats in ${seconds.toFixed(1)} s: ${builds.length} looks, median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms; ${pushes} pushes (${(pushes / seconds).toFixed(1)}/s) of ${(bytes / 1024).toFixed(0)} KB`);

    // nothing was lost on the way: the last look is the room as it is
    expect(last!.students).toHaveLength(STUDENTS);
    expect(last!.students.every((s) => s.state === 'inExam' && s.front === `Word · Report ${sent - 1}.docx`)).toBe(true);
    expect(last!.labApps).toMatchObject({ computers: 40 });
    // a look is quick, even on a busy CI computer; and the screens are told a few times a second, not hundreds
    expect(p95).toBeLessThan(150);
    expect(pushes / seconds).toBeLessThan(6);
    // what is sent has a size, however long the log is
    expect(last!.events.length).toBeLessThanOrEqual(3000);
    expect(bytes).toBeLessThan(1.5 * 1024 * 1024);
  }, 120_000);
});
