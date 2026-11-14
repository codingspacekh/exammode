import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Attempt } from '@lib/session/attempt';
import { Store } from '../../src/main/teacher/store/store';
import { at, openStore, tempFolder, year10 } from './helpers';

const sha = (c: string) => c.repeat(64);

describe('architecture §2.11 the teacher\'s store', () => {
  it('the migrations inside the program are the ones drizzle-kit generated (npm run db:generate)', async () => {
    const { migrationsModule } = await import('../../scripts/migrations.mjs');
    // (a Windows checkout may have other line ends)
    expect(readFileSync('src/main/teacher/store/migrations/index.ts', 'utf8').replaceAll('\r\n', '\n')).toBe(migrationsModule());
  });

  it('F-43 a class keeps its students, in name order, with their school emails', async () => {
    const store = openStore();
    const { cls } = await year10(store);
    const students = await store.students(cls.id);
    expect(students.map((s) => s.name)).toEqual(['Dara Kim', 'Mealea Heng', 'Sokha Chan', 'Vannak Sok']);
    expect(students[0]).toMatchObject({ email: 'dara.kim@school.edu', classId: cls.id });
  });

  it('F-02 two students of a class can\'t have the same school email', async () => {
    const store = openStore();
    await expect(store.addClass('Year 10 B', [{ name: 'A', email: 'a@school.edu' }, { name: 'B', email: 'a@school.edu' }])).rejects.toThrow();
  });

  it('a class with no students yet can be kept', async () => {
    const store = openStore();
    const cls = await store.addClass('Year 9 C', []);
    expect(await store.students(cls.id)).toEqual([]);
  });

  it('a run is found with its exam and its class', async () => {
    const store = openStore();
    const { exam } = await year10(store);
    const run = await store.openRun(exam.id, { code: '4817', folder: 'Year 10 ICT', at: at('08:55') });
    const found = await store.run(run.id);
    expect(found).toMatchObject({ className: 'Year 10 A', exam: { title: exam.title, minutes: 90, websites: [] }, run: { code: '4817', startedAt: null } });
    expect(await store.run('no-such-run')).toBeUndefined();
  });

  it('F-08 F-41 Start, added time and the end are kept with the run', async () => {
    const store = openStore();
    const { exam } = await year10(store);
    const run = await store.openRun(exam.id, { code: '4817', folder: 'f', at: at('08:55') });
    await store.updateRun(run.id, { startedAt: at('09:00'), extraMinutes: 5 });
    expect((await store.run(run.id))?.run).toMatchObject({ startedAt: at('09:00'), extraMinutes: 5, endedAt: null });
    expect((await store.runsNotEnded()).map((r) => r.id)).toEqual([run.id]);
    await store.updateRun(run.id, { endedAt: at('10:35') });
    expect(await store.runsNotEnded()).toEqual([]);
  });

  it('an attempt is written as it is now, one per student in a run', async () => {
    const store = openStore();
    const { exam, byName } = await year10(store);
    const run = await store.openRun(exam.id, { code: '4817', folder: 'f', at: at('08:55') });
    const dara = byName('Dara Kim').id;
    const checking: Attempt = { state: 'checking', pc: 'PC-07', instanceId: 'i-1', bootId: 'b-1', joinedAt: at('08:56'), lastBeatAt: at('08:56'), extraMinutes: 0, warnings: 0 };
    const id = await store.saveAttempt(run.id, dara, checking, { token: 't-1' });
    const left: Attempt = {
      ...checking, state: 'left', leftAt: at('09:20'), leftHow: 'stoppedSuddenly', asksBack: { pc: 'PC-09', instanceId: 'i-2', bootId: 'b-2' },
      checks: [{ check: 'oneScreen', ok: true }], extraMinutes: 5, warnings: 2, front: 'Word',
    };
    expect(await store.saveAttempt(run.id, dara, left, { token: 't-1' })).toBe(id);

    const saved = (await store.attempts(run.id)).get(dara);
    // when it was last heard from, and the app in front, are not kept (N-05)
    expect(saved).toEqual({ id, token: 't-1', receipt: undefined, attempt: { ...left, lastBeatAt: undefined, front: undefined, mayReturn: undefined, handedInAt: undefined, handedInHow: undefined } });
    expect(saved?.attempt).not.toHaveProperty('lastBeatAt');
    expect((await store.attempts(run.id)).size).toBe(1);
  });

  it('N-05 a run\'s data is still there after the teacher\'s laptop restarts', async () => {
    const path = join(await tempFolder(), 'exammode.db');
    const first = new Store(path);
    const { exam, byName } = await year10(first);
    const run = await first.openRun(exam.id, { code: '4817', folder: 'f', at: at('08:55') });
    await first.saveAttempt(run.id, byName('Sokha Chan').id, { state: 'handedIn', handedInAt: at('10:01'), handedInHow: 'handIn', extraMinutes: 0, warnings: 1 }, { receipt: 'HX7-29Q' });
    first.close();

    const again = new Store(path);
    expect((await again.attempts(run.id)).get(byName('Sokha Chan').id)).toMatchObject({ receipt: 'HX7-29Q', attempt: { state: 'handedIn', handedInHow: 'handIn', warnings: 1 } });
    again.close();
  });

  it('the log is kept in the order it was written', async () => {
    const store = openStore();
    const { exam, byName } = await year10(store);
    const run = await store.openRun(exam.id, { code: '4817', folder: 'f', at: at('08:55') });
    await store.log(run.id, []);
    await store.log(run.id, [
      { at: at('09:00'), kind: 'runStarted', details: {} },
      { studentId: byName('Dara Kim').id, pc: 'PC-07', at: at('09:12'), kind: 'appClosed', details: { app: 'Chrome' } },
    ]);
    await store.log(run.id, [{ studentId: byName('Dara Kim').id, at: at('09:11'), kind: 'gap', details: { seconds: 45 } }]);
    const events = await store.events(run.id);
    expect(events.map((e) => e.kind)).toEqual(['runStarted', 'appClosed', 'gap']);
    expect(events[1]).toMatchObject({ pc: 'PC-07', details: { app: 'Chrome' }, studentId: byName('Dara Kim').id });
    expect(events[0]).toMatchObject({ studentId: null, pc: null });
  });

  it('F-22 the teacher keeps the latest copy of each file; a hand-in is told apart from the backups before it', async () => {
    const store = openStore();
    const { exam, byName } = await year10(store);
    const run = await store.openRun(exam.id, { code: '4817', folder: 'f', at: at('08:55') });
    const id = await store.saveAttempt(run.id, byName('Dara Kim').id, { state: 'inExam', extraMinutes: 0, warnings: 0 });
    await store.saveFiles(id, [{ name: 'Report.docx', bytes: 10, sha256: sha('a') }, { name: 'old.txt', bytes: 1, sha256: sha('c') }], 'backup', at('09:02'));
    await store.saveFiles(id, [{ name: 'Report.docx', bytes: 12, sha256: sha('b') }], 'backup', at('09:04'));
    expect(await store.files(id)).toEqual([
      { attemptId: id, name: 'Report.docx', bytes: 12, sha256: sha('b'), kind: 'backup', at: at('09:04') },
      { attemptId: id, name: 'old.txt', bytes: 1, sha256: sha('c'), kind: 'backup', at: at('09:02') },
    ]);
    await store.saveFiles(id, [{ name: 'Report.docx', bytes: 12, sha256: sha('b') }], 'handIn', at('10:00'));
    expect((await store.handedIn(id, 'handIn')).map((f) => f.name)).toEqual(['Report.docx']);
  });
});
