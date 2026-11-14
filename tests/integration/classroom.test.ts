import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { receiptCode } from '@lib/files/receipt';
import type { FromStudent, FromTeacher, Upload } from '@lib/protocol/messages';
import { Classroom, EARLIER, WRONG_CODES, type Link } from '../../src/main/teacher/classroom';
import { newIncoming, receive, type Received } from '../../src/main/teacher/handIns';
import type { Store } from '../../src/main/teacher/store/store';
import { at, openStore, tempFolder, year10 } from './helpers';

const v = 1;
const MIN = 60_000;
/** what a student's ExamMode is told about the exam when it joins */
const EXAM = { title: 'Year 10 ICT — Term 1 practical exam', teacher: 'Ms Srey Leak', class: 'Year 10 A', minutes: 90, websites: [], apps: [], files: [] };

/** A student's connection that only remembers what it was sent. */
class FakeLink implements Link {
  sent: FromTeacher[] = [];
  closed = false;
  constructor(readonly from = '10.0.0.7') {}
  send(msg: FromTeacher): void {
    this.sent.push(msg);
  }
  close(): void {
    this.closed = true;
  }
  get last(): FromTeacher | undefined {
    return this.sent.at(-1);
  }
  /** the token of the last `joined` */
  get token(): string {
    const joined = this.sent.findLast((m) => m.type === 'joined');
    if (joined?.type !== 'joined') throw new Error('not joined');
    return joined.token;
  }
}

/** The prototype's run: opened at 08:55 with the code 4817; the clock is the test's to move. */
async function lesson(store: Store = openStore(), handIns?: string) {
  const clock = { now: at('08:55') };
  const { exam, byName } = await year10(store);
  const folder = handIns ?? await tempFolder();
  const room = await Classroom.create(store, exam.id, { handIns: folder, now: () => clock.now, code: '4817' });
  const id = (name: string) => byName(name).id;
  const say = (link: Link, msg: Record<string, unknown>) => room.receive(link, { v, ...msg } as FromStudent);
  const join = async (name: string, over: Record<string, unknown> = {}, link = new FakeLink()) => {
    await say(link, { type: 'join', runId: room.id, studentId: id(name), code: '4817', pc: 'PC-07', instanceId: 'i-1', bootId: 'b-1', ...over });
    return link;
  };
  /** joined, checked and locked */
  const ready = async (name: string, over: Record<string, unknown> = {}) => {
    const link = await join(name, over);
    await say(link, { type: 'checks', results: [{ check: 'oneScreen', ok: true }] });
    await say(link, { type: 'ready' });
    return link;
  };
  const state = (name: string) => room.view().students.find((s) => s.id === id(name))!;
  const kinds = async (name?: string) => (await store.events(room.id)).filter((e) => !name || e.studentId === id(name)).map((e) => e.kind);
  const files = async (...contents: [string, string][]): Promise<{ meta: Upload['files']; received: Received[] }> => {
    const incoming = await newIncoming(folder);
    const received = await Promise.all(contents.map(([name, text]) => receive(name, Readable.from([Buffer.from(text)]), incoming)));
    return { meta: received.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), received };
  };
  const upload = async (link: FakeLink, kind: Upload['kind'], ...contents: [string, string][]) => {
    const { meta, received } = await files(...contents);
    return room.upload({ v, token: link.token, kind, files: meta }, received);
  };
  return { room, store, clock, folder, id, say, join, ready, state, kinds, files, upload };
}

describe('F-01 F-02 F-03 joining a run', () => {
  it('a new run has a four-digit code for the board, a folder in Hand-ins, and is in the log', async () => {
    const store = openStore();
    const { exam } = await year10(store);
    const handIns = await tempFolder();
    const room = await Classroom.create(store, exam.id, { handIns, now: () => at('08:55') });
    expect(room.view().run).toMatchObject({ title: exam.title, teacher: 'Ms Srey Leak', className: 'Year 10 A', minutes: 90, openedAt: at('08:55') });
    expect(room.view().run.code).toMatch(/^\d{4}$/);
    expect(room.view().run.folder.startsWith(join(handIns, 'Year 10 ICT — Term 1 practical exam 2026-11-12 '))).toBe(true);
    expect(existsSync(room.view().run.folder)).toBe(true);
    expect((await store.events(room.id)).map((e) => e.kind)).toEqual(['runOpened']);
    expect(room.listing()).toEqual({ runId: room.id, title: exam.title, teacher: 'Ms Srey Leak', class: 'Year 10 A', minutes: 90 });
    await expect(Classroom.create(store, 'no-such-exam', { handIns })).rejects.toThrow();
    await expect(Classroom.open(store, 'no-such-run', { handIns })).rejects.toThrow();
  });

  it('F-02 the class list to pick a name from shows an email only where a name is shared', async () => {
    const store = openStore();
    const cls = await store.addClass('Year 10 A', [{ name: 'Sokha Chan', email: 'sokha1@school.edu' }, { name: 'Sokha Chan', email: 'sokha2@school.edu' }, { name: 'Dara Kim', email: 'dara@school.edu' }]);
    const exam = await store.addExam({ title: 'T', teacher: 'Ms Srey Leak', classId: cls.id, minutes: 30 }, at('08:50'));
    const room = await Classroom.create(store, exam.id, { handIns: await tempFolder() });
    expect(room.names().map(({ name, email }) => ({ name, email }))).toEqual([
      { name: 'Dara Kim', email: undefined }, { name: 'Sokha Chan', email: 'sokha1@school.edu' }, { name: 'Sokha Chan', email: 'sokha2@school.edu' },
    ]);
    expect(room.folderOf(cls.students[0]!.id)).toMatch(/Sokha Chan \(sokha1@school\.edu\)$/);
  });

  it('a student with the right code and a name from the class is in: the checks start', async () => {
    const { join, state, kinds, clock } = await lesson();
    const link = await join('Dara Kim');
    expect(link.last).toEqual({ v, type: 'joined', token: expect.stringMatching(/^[\w-]{20,}$/), now: clock.now, state: 'checking', endsAt: undefined, exam: EXAM });
    expect(state('Dara Kim')).toMatchObject({ state: 'checking', pc: 'PC-07', connected: true, warnings: 0 });
    expect(await kinds('Dara Kim')).toEqual(['joined']);
  });

  it('F-03 a wrong code is refused, and written in the log with the computer', async () => {
    const { join, state, store, room } = await lesson();
    const link = await join('Dara Kim', { code: '0000' });
    expect(link.last).toEqual({ v, type: 'refused', reason: 'codeWrong' });
    expect(link.closed).toBe(true);
    expect(state('Dara Kim').state).toBe('notJoined');
    expect((await store.events(room.id)).at(-1)).toMatchObject({ kind: 'codeWrong', pc: 'PC-07', studentId: null });
  });

  it('F-03 after five wrong codes a computer waits a minute, so the code can\'t be found by trying them all', async () => {
    const { join, clock } = await lesson();
    for (let i = 0; i < WRONG_CODES; i++) await join('Dara Kim', { code: `000${i}` });
    expect((await join('Dara Kim')).last).toMatchObject({ reason: 'codeWrong' });
    // another computer isn't held up
    expect((await join('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' }, new FakeLink('10.0.0.8'))).last).toMatchObject({ type: 'joined' });
    clock.now += MIN;
    expect((await join('Dara Kim')).last).toMatchObject({ type: 'joined' });
  });

  it('a few wrong codes are forgotten once the right one is typed', async () => {
    const { join } = await lesson();
    for (let i = 0; i < WRONG_CODES - 1; i++) await join('Dara Kim', { code: '0000' });
    expect((await join('Dara Kim')).last).toMatchObject({ type: 'joined' });
    for (let i = 0; i < WRONG_CODES - 1; i++) await join('Sokha Chan', { code: '0000' });
    expect((await join('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' })).last).toMatchObject({ type: 'joined' });
  });

  it('F-02 someone who isn\'t in the class is refused', async () => {
    const { join } = await lesson();
    const link = await join('Dara Kim', { studentId: 'someone-else' });
    expect(link.last).toEqual({ v, type: 'refused', reason: 'notInClass' });
    expect(link.closed).toBe(true);
  });

  it('F-02 a name that is in the run on another computer can\'t be picked; the student who has it isn\'t touched', async () => {
    const { join, state, kinds } = await lesson();
    const dara = await join('Dara Kim');
    const other = await join('Dara Kim', { pc: 'PC-12', instanceId: 'i-12' }, new FakeLink('10.0.0.12'));
    expect(other.last).toEqual({ v, type: 'refused', reason: 'nameTaken' });
    expect(other.closed).toBe(true);
    expect(dara.closed).toBe(false);
    expect(state('Dara Kim')).toMatchObject({ state: 'checking', pc: 'PC-07' });
    expect(await kinds('Dara Kim')).toEqual(['joined', 'nameTaken']);
  });

  it('what a connection that hasn\'t joined says is ignored', async () => {
    const { say, state, kinds } = await lesson();
    const stranger = new FakeLink();
    await say(stranger, { type: 'ready' });
    await say(stranger, { type: 'event', kind: 'appClosed', details: {} });
    expect(stranger.sent).toEqual([]);
    expect(state('Dara Kim').state).toBe('notJoined');
    expect(await kinds()).toEqual(['runOpened']);
  });
});

describe('F-08 the exam starts on every computer at once', () => {
  it('Start puts every ready student in the exam and tells each when it ends', async () => {
    const { room, ready, join, state, clock, kinds } = await lesson();
    const dara = await ready('Dara Kim');
    const sokha = await ready('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' });
    const vannak = await join('Vannak Sok', { pc: 'PC-09', instanceId: 'i-9' });
    expect(state('Dara Kim').state).toBe('ready');

    clock.now = at('09:00');
    await room.start();
    const start = { v, type: 'start', endsAt: at('10:30') };
    expect(dara.last).toEqual(start);
    expect(sokha.last).toEqual(start);
    expect(vannak.last).toMatchObject({ type: 'joined' });
    expect(state('Dara Kim')).toMatchObject({ state: 'inExam', endsAt: at('10:30') });
    expect(state('Vannak Sok').state).toBe('checking');
    expect(room.view().run).toMatchObject({ startedAt: at('09:00'), endsAt: at('10:30') });
    expect(await kinds('Dara Kim')).toEqual(['joined', 'ready', 'started']);

    await room.start();
    expect((await kinds()).filter((k) => k === 'runStarted')).toHaveLength(1);
  });

  it('a late joiner is in the exam as soon as their computer is locked, with the time that is left', async () => {
    const { room, ready, state, clock, kinds } = await lesson();
    clock.now = at('09:00');
    await room.start();
    clock.now = at('09:10');
    const mealea = await ready('Mealea Heng');
    expect(mealea.last).toEqual({ v, type: 'start', endsAt: at('10:30') });
    expect(state('Mealea Heng').state).toBe('inExam');
    expect(await kinds('Mealea Heng')).toEqual(['joined', 'ready', 'joinedLate']);
  });

  it('a failed check is shown to the teacher (F-04)', async () => {
    const { join, say, kinds, store, room } = await lesson();
    const link = await join('Dara Kim');
    await say(link, { type: 'checks', results: [{ check: 'oneScreen', ok: false }, { check: 'noRemote', ok: true }] });
    expect(await kinds('Dara Kim')).toEqual(['joined', 'checkFailed']);
    expect((await store.attempts(room.id)).get((await store.events(room.id))[1]!.studentId!)?.attempt.checks).toHaveLength(2);
  });

  it('what a student\'s computer reports is in the log; closed apps count as warnings', async () => {
    const { room, ready, say, state, store, clock } = await lesson();
    const dara = await ready('Dara Kim');
    await room.start();
    clock.now = at('09:12');
    await say(dara, { type: 'beat', seq: 1, front: 'Word' });
    await say(dara, { type: 'event', kind: 'appClosed', details: { app: 'Chrome' } });
    await say(dara, { type: 'event', kind: 'pageBlocked', details: { url: 'https://chat.example' } });
    expect(state('Dara Kim')).toMatchObject({ front: 'Word', warnings: 1 });
    expect((await store.events(room.id)).slice(-2)).toMatchObject([
      { kind: 'appClosed', pc: 'PC-07', at: at('09:12'), details: { app: 'Chrome' } }, { kind: 'pageBlocked' },
    ]);
  });
});

describe('F-18 before Start, leaving or stopping only takes the student off the list', () => {
  it('ExamMode crashes in the lobby: after 10 s the student is off the list and joins again normally', async () => {
    const { room, ready, join, state, clock, kinds } = await lesson();
    const first = await ready('Dara Kim');
    clock.now += 11_000;
    await room.tick();
    expect(state('Dara Kim')).toMatchObject({ state: 'notJoined', connected: false });
    expect(first.closed).toBe(true);

    const again = await join('Dara Kim', { instanceId: 'i-2' });
    expect(again.last).toMatchObject({ type: 'joined', state: 'checking' });
    expect(again.token).not.toBe(first.token);
    expect(await kinds('Dara Kim')).toEqual(['joined', 'ready', 'leftBeforeStart', 'joined']);
  });

  it('the token of a student who is off the list is worth nothing', async () => {
    const { room, join, say, clock } = await lesson();
    const first = await join('Dara Kim');
    await say(first, { type: 'leave' });
    clock.now += 1000;
    const back = new FakeLink();
    await say(back, { type: 'resume', token: first.token, instanceId: 'i-1', localLog: [] });
    expect(back.last).toEqual({ v, type: 'refused', reason: 'notJoined' });
    expect(back.closed).toBe(true);
    expect(await room.stopped({ v, type: 'stopped', token: first.token, pc: 'PC-07', instanceId: 'i-1', at: clock.now })).toBe(false);
  });

  it('the Guard\'s stopped before Start takes the student off the list', async () => {
    const { room, ready, state, clock } = await lesson();
    const dara = await ready('Dara Kim');
    expect(await room.stopped({ v, type: 'stopped', token: dara.token, pc: 'PC-07', instanceId: 'i-1', at: clock.now })).toBe(true);
    expect(state('Dara Kim').state).toBe('notJoined');
  });

  it('ExamMode started again on the same computer before Start: the checks run again, the old connection is closed', async () => {
    const { join, state } = await lesson();
    const first = await join('Dara Kim');
    const second = await join('Dara Kim', { instanceId: 'i-2' });
    expect(second.last).toMatchObject({ type: 'joined', state: 'checking' });
    expect(first.closed).toBe(true);
    expect(state('Dara Kim')).toMatchObject({ state: 'checking', connected: true });
  });
});

describe('F-19 losing the network is not leaving', () => {
  it('no beat for 10 s is no contact; the same ExamMode coming back is in the exam again, with the gap in the log', async () => {
    const { room, ready, say, state, clock, store } = await lesson();
    const dara = await ready('Dara Kim');
    clock.now = at('09:00');
    await room.start();
    await say(dara, { type: 'beat', seq: 1 });
    room.dropped(dara);
    expect(state('Dara Kim')).toMatchObject({ state: 'inExam', connected: false });

    clock.now = at('09:00:09');
    await room.tick();
    expect(state('Dara Kim').state).toBe('inExam');
    clock.now = at('09:00:11');
    await room.tick();
    expect(state('Dara Kim').state).toBe('noContact');

    clock.now = at('09:00:45');
    const back = new FakeLink();
    const localLog = [{ at: at('09:00:02'), kind: 'contactLost', details: {} }];
    await say(back, { type: 'resume', token: dara.token, instanceId: 'i-1', localLog });
    expect(back.last).toEqual({ v, type: 'joined', token: dara.token, now: clock.now, state: 'inExam', endsAt: at('10:30'), exam: EXAM });
    expect(state('Dara Kim')).toMatchObject({ state: 'inExam', connected: true, warnings: 0 });
    expect((await store.events(room.id)).slice(-2)).toMatchObject([
      { kind: 'noContact' }, { kind: 'gap', details: { seconds: 45, localLog } },
    ]);
  });

  it('a beat arriving again ends no contact as well', async () => {
    const { room, ready, say, state, clock } = await lesson();
    const dara = await ready('Dara Kim');
    await room.start();
    clock.now += 12_000;
    await room.tick();
    expect(state('Dara Kim').state).toBe('noContact');
    await say(dara, { type: 'beat', seq: 7 });
    expect(state('Dara Kim').state).toBe('inExam');
  });

  it('a resume with a token nobody has is refused', async () => {
    const { say } = await lesson();
    const link = new FakeLink();
    await say(link, { type: 'resume', token: 'made-up', instanceId: 'i-1', localLog: [] });
    expect(link.last).toEqual({ v, type: 'refused', reason: 'notJoined' });
  });
});

describe('F-15 F-18 F-20 F-40 leaving, stopping suddenly, and coming back', () => {
  async function inExam() {
    const l = await lesson();
    const dara = await l.ready('Dara Kim');
    l.clock.now = at('09:00');
    await l.room.start();
    l.clock.now = at('09:20');
    return { ...l, dara };
  }

  it('F-15 Leave in the exam: left, and the connection is closed', async () => {
    const { say, state, dara, kinds } = await inExam();
    await say(dara, { type: 'leave' });
    expect(state('Dara Kim')).toMatchObject({ state: 'left', leftHow: 'pressedLeave', connected: false });
    expect(dara.closed).toBe(true);
    expect((await kinds('Dara Kim')).at(-1)).toBe('left');
  });

  it('F-18 a student who left joins from another computer: refused, the teacher told; Let back in opens the exam there', async () => {
    const { room, say, join, state, dara, kinds, id, clock, store } = await inExam();
    await say(dara, { type: 'leave' });
    clock.now = at('09:25');
    const asks = await join('Dara Kim', { pc: 'PC-12', instanceId: 'i-12', bootId: 'b-12' });
    // refused, and told when and how they left: what screen 10 shows
    expect(asks.last).toEqual({ v, type: 'refused', reason: 'left', left: { at: at('09:20'), how: 'pressedLeave', pc: 'PC-07' } });
    expect(asks.closed).toBe(false);
    expect(state('Dara Kim')).toMatchObject({ state: 'left', asksBackFrom: 'PC-12' });

    clock.now = at('09:27');
    await room.letBackIn(id('Dara Kim'), 'the power went off in her row');
    expect(asks.last).toEqual({ v, type: 'joined', token: expect.any(String), now: clock.now, state: 'inExam', endsAt: at('10:30'), exam: EXAM });
    expect(asks.token).not.toBe(dara.token);
    expect(state('Dara Kim')).toMatchObject({ state: 'inExam', pc: 'PC-12', connected: true, asksBackFrom: undefined });
    expect((await kinds('Dara Kim')).slice(-4)).toEqual(['left', 'asksBack', 'letBackIn', 'cameBack']);
    expect((await store.events(room.id)).slice(-2)).toMatchObject([
      { details: { reason: 'the power went off in her row' } }, { pc: 'PC-12', details: { secondsOut: 420 } },
    ]);
  });

  it('F-40 Let back in before the student has asked: their next join is accepted', async () => {
    const { room, say, join, dara, id } = await inExam();
    await say(dara, { type: 'leave' });
    await room.letBackIn(id('Dara Kim'), 'pressed Leave by mistake');
    const back = await join('Dara Kim', { instanceId: 'i-2' });
    expect(back.last).toMatchObject({ type: 'joined', state: 'inExam', endsAt: at('10:30') });
  });

  it('F-40 Keep out: the waiting join is refused and its connection closed', async () => {
    const { room, say, join, state, dara, id, kinds } = await inExam();
    await say(dara, { type: 'leave' });
    const asks = await join('Dara Kim', { instanceId: 'i-2' });
    await room.keepOut(id('Dara Kim'), 'left the room with her phone');
    expect(asks.last).toEqual({ v, type: 'refused', reason: 'keptOut' });
    expect(asks.closed).toBe(true);
    expect(state('Dara Kim')).toMatchObject({ state: 'left', asksBackFrom: undefined });
    expect((await kinds('Dara Kim')).at(-1)).toBe('keptOut');
  });

  it('a student who asks twice waits on the newer connection only', async () => {
    const { room, say, join, dara, id } = await inExam();
    await say(dara, { type: 'leave' });
    const first = await join('Dara Kim', { instanceId: 'i-2' });
    const second = await join('Dara Kim', { instanceId: 'i-3' });
    expect(first.closed).toBe(true);
    await room.letBackIn(id('Dara Kim'), 'ok');
    expect(second.last).toMatchObject({ type: 'joined' });
    expect(first.sent).toHaveLength(1);
  });

  it('a waiting student who goes away is still let back in when they join next', async () => {
    const { room, say, join, dara, id, state } = await inExam();
    await say(dara, { type: 'leave' });
    const asks = await join('Dara Kim', { instanceId: 'i-2' });
    room.dropped(asks);
    await room.letBackIn(id('Dara Kim'), 'ok');
    expect(state('Dara Kim')).toMatchObject({ state: 'inExam', connected: false });
    expect((await join('Dara Kim', { instanceId: 'i-2' })).last).toMatchObject({ type: 'joined', state: 'inExam' });
  });

  it('F-20 the Guard reports that ExamMode stopped: left (stopped suddenly), counted from when it was last heard from', async () => {
    const { room, say, state, dara, clock, store, id } = await inExam();
    await say(dara, { type: 'beat', seq: 1 });
    clock.now = at('09:20:03');
    expect(await room.stopped({ v, type: 'stopped', token: dara.token, pc: 'PC-07', instanceId: 'i-1', at: 0 })).toBe(true);
    expect(state('Dara Kim')).toMatchObject({ state: 'left', leftHow: 'stoppedSuddenly' });
    expect((await store.attempts(room.id)).get(id('Dara Kim'))?.attempt.leftAt).toBe(at('09:20'));
    expect(await room.stopped({ v, type: 'stopped', token: 'made-up', pc: 'PC-07', instanceId: 'i-1', at: 0 })).toBe(false);
  });

  it('F-20 a new ExamMode joins for a student in the exam: the old one had stopped; the join waits for the teacher', async () => {
    const { join, state, kinds } = await inExam();
    const asks = await join('Dara Kim', { instanceId: 'i-2', bootId: 'b-2' });
    expect(asks.last).toMatchObject({ type: 'refused', reason: 'left', left: { how: 'stoppedSuddenly', pc: 'PC-07' } });
    expect(state('Dara Kim')).toMatchObject({ state: 'left', leftHow: 'stoppedSuddenly', asksBackFrom: 'PC-07' });
    expect((await kinds('Dara Kim')).slice(-2)).toEqual(['stoppedSuddenly', 'asksBack']);
  });

  it('the same ExamMode joining again while in the exam is just in', async () => {
    const { join, state, dara } = await inExam();
    const again = await join('Dara Kim');
    expect(again.last).toMatchObject({ type: 'joined', state: 'inExam', token: dara.token });
    expect(dara.closed).toBe(true);
    expect(state('Dara Kim').state).toBe('inExam');
  });
});

describe('F-17 F-41 time', () => {
  it('F-41 Add time for everyone: each student in the exam is told the new end', async () => {
    const { room, ready, clock, state, kinds } = await lesson();
    const dara = await ready('Dara Kim');
    const sokha = await ready('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' });
    clock.now = at('09:00');
    await room.addTime(5);
    expect(dara.last).toMatchObject({ type: 'joined' });
    await room.start();
    await room.addTime(10);
    expect(dara.last).toEqual({ v, type: 'time', endsAt: at('10:45') });
    expect(sokha.last).toEqual({ v, type: 'time', endsAt: at('10:45') });
    expect(room.view().run).toMatchObject({ extraMinutes: 15, endsAt: at('10:45') });
    expect(state('Dara Kim').endsAt).toBe(at('10:45'));
    expect((await kinds()).filter((k) => k === 'timeAdded')).toHaveLength(2);
  });

  it('F-41 Add time for one student: only they are told', async () => {
    const { room, ready, clock, state, id } = await lesson();
    const dara = await ready('Dara Kim');
    const sokha = await ready('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' });
    clock.now = at('09:00');
    await room.start();
    await room.addTime(10, id('Dara Kim'));
    expect(dara.last).toEqual({ v, type: 'time', endsAt: at('10:40') });
    expect(sokha.last).toMatchObject({ type: 'start' });
    expect(state('Dara Kim')).toMatchObject({ extraMinutes: 10, endsAt: at('10:40') });
    expect(state('Sokha Chan').endsAt).toBe(at('10:30'));
  });

  it('F-17 when a student\'s time is up they are told once to hand in; with more time, again at the new end', async () => {
    const { room, ready, clock, id } = await lesson();
    const dara = await ready('Dara Kim');
    const sokha = await ready('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' });
    clock.now = at('09:00');
    await room.start();
    await room.addTime(5, id('Sokha Chan'));
    const beats = async () => {
      await room.receive(dara, { v, type: 'beat', seq: 1 });
      await room.receive(sokha, { v, type: 'beat', seq: 1 });
    };
    clock.now = at('10:29:59');
    await beats();
    await room.tick();
    expect(dara.last).toMatchObject({ type: 'start' });

    clock.now = at('10:30');
    await beats();
    await room.tick();
    await room.tick();
    expect(dara.sent.filter((m) => m.type === 'end')).toHaveLength(1);
    expect(sokha.sent.filter((m) => m.type === 'end')).toHaveLength(0);

    await room.addTime(2, id('Dara Kim'));
    clock.now = at('10:32');
    await beats();
    await room.tick();
    expect(dara.sent.filter((m) => m.type === 'end')).toHaveLength(2);
  });

  it('F-41 End the exam: everyone in it is told to hand in, nobody can join any more, and the run is no longer announced', async () => {
    const { room, ready, join, say, clock } = await lesson();
    const dara = await ready('Dara Kim');
    const sokha = await ready('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' });
    clock.now = at('09:00');
    await room.start();
    await say(sokha, { type: 'leave' });
    const asks = await join('Sokha Chan', { pc: 'PC-08', instanceId: 'i-9' });

    clock.now = at('09:40');
    await room.end();
    await room.end();
    expect(dara.sent.filter((m) => m.type === 'end')).toHaveLength(1);
    expect(asks.last).toEqual({ v, type: 'refused', reason: 'ended' });
    expect(asks.closed).toBe(true);
    expect(room.view().run.endedAt).toBe(at('09:40'));
    expect(room.listing()).toBeUndefined();
    expect((await join('Vannak Sok', { pc: 'PC-09', instanceId: 'i-10' })).last).toEqual({ v, type: 'refused', reason: 'ended' });
    await room.start();
    expect(room.view().run.startedAt).toBe(at('09:00'));
  });
});

describe('F-16 F-22 backups and the hand-in', () => {
  const read = (...path: string[]) => readFileSync(join(...path), 'utf8');
  async function working() {
    const l = await lesson();
    const dara = await l.ready('Dara Kim');
    l.clock.now = at('09:00');
    await l.room.start();
    const folder = l.room.folderOf(l.id('Dara Kim'));
    const saved = async () => (await l.store.files((await l.store.attempts(l.room.id)).get(l.id('Dara Kim'))!.id)).map((f) => `${f.name}:${f.kind}`);
    return { ...l, dara, folder, saved };
  }

  it('F-22 a backup\'s files are checked and kept in the student\'s folder; a newer copy takes the older one\'s place', async () => {
    const { upload, dara, folder, saved, clock, state } = await working();
    clock.now = at('09:02');
    expect(await upload(dara, 'backup', ['Report.docx', 'first draft'], ['site/index.html', '<h1>Hi</h1>'])).toEqual({ ok: true });
    clock.now = at('09:04');
    expect(await upload(dara, 'backup', ['Report.docx', 'second draft'])).toEqual({ ok: true });
    expect(folder.endsWith('Dara Kim')).toBe(true);
    expect(read(folder, 'Report.docx')).toBe('second draft');
    expect(read(folder, 'site', 'index.html')).toBe('<h1>Hi</h1>');
    expect(await saved()).toEqual(['Report.docx:backup', 'site/index.html:backup']);
    expect(state('Dara Kim').state).toBe('inExam');
  });

  it('N-05 a file that isn\'t the one announced is refused, and the good copy stays', async () => {
    const { room, upload, files, dara, folder } = await working();
    await upload(dara, 'backup', ['Report.docx', 'good']);
    const { meta, received } = await files(['Report.docx', 'cut sho']);
    const announced = [{ ...meta[0]!, sha256: createHash('sha256').update('cut short').digest('hex') }];
    expect(await room.upload({ v, token: dara.token, kind: 'backup', files: announced }, received)).toEqual({ ok: false, why: 'mismatch' });
    expect(await room.upload({ v, token: dara.token, kind: 'backup', files: [{ ...meta[0]!, bytes: 99 }] }, received)).toEqual({ ok: false, why: 'mismatch' });
    expect(await room.upload({ v, token: dara.token, kind: 'backup', files: meta }, [])).toEqual({ ok: false, why: 'mismatch' });
    expect(await room.upload({ v, token: dara.token, kind: 'backup', files: [...meta, ...meta] }, received)).toEqual({ ok: false, why: 'mismatch' });
    expect(read(folder, 'Report.docx')).toBe('good');
  });

  it('a file name that would leave the student\'s folder is refused', async () => {
    const { room, files, dara, folder } = await working();
    const { meta, received } = await files(['../Sokha Chan/Report.docx', 'mine now']);
    expect(await room.upload({ v, token: dara.token, kind: 'backup', files: meta }, received)).toEqual({ ok: false, why: 'mismatch' });
    expect(existsSync(join(folder, '..', 'Sokha Chan'))).toBe(false);
  });

  it('files are taken only from a student who is in the exam', async () => {
    const { room, join, files, say, dara } = await working();
    const { meta, received } = await files(['a.txt', 'a']);
    expect(await room.upload({ v, token: 'made-up', kind: 'backup', files: meta }, received)).toEqual({ ok: false, why: 'unknown' });
    const lobby = await join('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' });
    expect(await room.upload({ v, token: lobby.token, kind: 'backup', files: meta }, received)).toEqual({ ok: false, why: 'refused' });
    await say(dara, { type: 'leave' });
    expect(room.mayUpload({ v, token: dara.token, kind: 'handIn', files: meta })).toBe('refused');
  });

  it('F-16 a hand-in is answered with the receipt both sides can work out; the student has handed in', async () => {
    const { room, upload, dara, state, id, clock, kinds, saved, store } = await working();
    clock.now = at('09:50');
    const result = await upload(dara, 'handIn', ['Report.docx', 'final'], ['main.py', 'print(1)']);
    if (!result.ok || !result.receipt) throw new Error('no receipt');
    expect(result.receipt.code).toBe(await receiptCode(room.id, id('Dara Kim'), result.receipt.files));
    expect(result.receipt.files.map((f) => f.name)).toEqual(['Report.docx', 'main.py']);
    expect(state('Dara Kim')).toMatchObject({ state: 'handedIn', handedInHow: 'handIn', receipt: result.receipt.code });
    expect((await kinds('Dara Kim')).at(-1)).toBe('handedIn');
    expect(await saved()).toEqual(['Report.docx:handIn', 'main.py:handIn']);
    expect((await store.attempts(room.id)).get(id('Dara Kim'))).toMatchObject({ receipt: result.receipt.code, attempt: { handedInAt: at('09:50') } });
  });

  it('a student who made nothing still hands in, and gets a receipt', async () => {
    const { upload, dara, state } = await working();
    expect(await upload(dara, 'handIn')).toMatchObject({ ok: true, receipt: { files: [] } });
    expect(state('Dara Kim').state).toBe('handedIn');
  });

  it('F-16 a hand-in whose receipt was lost on the way can be sent again; a different one is refused', async () => {
    const { upload, dara } = await working();
    const first = await upload(dara, 'handIn', ['Report.docx', 'final']);
    expect(await upload(dara, 'handIn', ['Report.docx', 'final'])).toEqual(first);
    expect(await upload(dara, 'handIn', ['Report.docx', 'changed afterwards'])).toEqual({ ok: false, why: 'refused' });
    expect(await upload(dara, 'backup', ['Report.docx', 'changed afterwards'])).toEqual({ ok: false, why: 'refused' });
  });

  it('F-17 a hand-in at the end of the time is marked time up; after End the exam, ended', async () => {
    const { room, ready, upload, dara, state, clock } = await working();
    const sokha = await ready('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' });
    clock.now = at('10:29:59');
    await upload(dara, 'handIn', ['a.txt', 'a']);
    expect(state('Dara Kim').handedInHow).toBe('timeUp');
    await room.end();
    await upload(sokha, 'handIn', ['b.txt', 'b']);
    expect(state('Sokha Chan').handedInHow).toBe('ended');
  });

  it('backups of files that aren\'t in the hand-in are kept apart, not lost', async () => {
    const { upload, dara, folder, saved } = await working();
    await upload(dara, 'backup', ['Report.docx', 'draft'], ['notes/deleted later.txt', 'scrap']);
    await upload(dara, 'handIn', ['Report.docx', 'final']);
    expect(read(folder, 'Report.docx')).toBe('final');
    expect(existsSync(join(folder, 'notes', 'deleted later.txt'))).toBe(false);
    expect(read(folder, EARLIER, 'notes', 'deleted later.txt')).toBe('scrap');
    expect(await saved()).toEqual(['Report.docx:handIn', 'notes/deleted later.txt:backup']);
  });

  it('a student with no contact can still send files', async () => {
    const { room, upload, dara, clock, state } = await working();
    clock.now += 11_000;
    await room.tick();
    expect(state('Dara Kim').state).toBe('noContact');
    expect(await upload(dara, 'backup', ['a.txt', 'a'])).toEqual({ ok: true });
  });
});

describe('N-03 N-05 the live view and a restart', () => {
  it('N-03 every change is told to whoever listens, with the student it is about', async () => {
    const { room, ready, say, id, clock } = await lesson();
    const seen: (string | undefined)[] = [];
    const stop = room.onChange((studentId) => seen.push(studentId));
    const dara = await ready('Dara Kim');
    expect(new Set(seen)).toEqual(new Set([id('Dara Kim')]));
    seen.length = 0;
    await room.start();
    expect(seen).toEqual([undefined, id('Dara Kim')]);
    seen.length = 0;
    // a beat that changes nothing isn't a change; a new app in front is
    clock.now += 2000;
    await say(dara, { type: 'beat', seq: 1 });
    expect(seen).toEqual([]);
    await say(dara, { type: 'beat', seq: 2, front: 'Excel' });
    expect(seen).toEqual([id('Dara Kim')]);
    stop();
    await say(dara, { type: 'leave' });
    expect(seen).toHaveLength(1);
  });

  it('N-05 the teacher\'s laptop restarts during an exam: the run opens as it was, and nobody is no contact just for that', async () => {
    const path = join(await tempFolder(), 'exammode.db');
    const handIns = await tempFolder();
    const first = await lesson(openStore(path), handIns);
    const dara = await first.ready('Dara Kim');
    const sokha = await first.ready('Sokha Chan', { pc: 'PC-08', instanceId: 'i-8' });
    first.clock.now = at('09:00');
    await first.room.start();
    await first.say(sokha, { type: 'leave' });
    await first.upload(dara, 'backup', ['Report.docx', 'draft']);

    // the laptop is off for five minutes
    const clock = { now: at('09:15') };
    const store = openStore(path);
    const room = await Classroom.open(store, first.room.id, { handIns, now: () => clock.now });
    const state = (name: string) => room.view().students.find((s) => s.id === first.id(name))!;
    expect(room.view().run).toMatchObject({ code: '4817', startedAt: at('09:00'), endsAt: at('10:30') });
    expect(state('Dara Kim')).toMatchObject({ state: 'inExam', pc: 'PC-07', connected: false });
    expect(state('Sokha Chan')).toMatchObject({ state: 'left', leftHow: 'pressedLeave' });
    expect(state('Vannak Sok').state).toBe('notJoined');

    await room.tick();
    clock.now += 9000;
    await room.tick();
    expect(state('Dara Kim').state).toBe('inExam');

    const back = new FakeLink();
    await room.receive(back, { v, type: 'resume', token: dara.token, instanceId: 'i-1', localLog: [] });
    expect(back.last).toMatchObject({ type: 'joined', state: 'inExam', token: dara.token, endsAt: at('10:30') });
    const { meta, received } = await first.files(['Report.docx', 'final']);
    expect(await room.upload({ v, token: dara.token, kind: 'handIn', files: meta }, received)).toMatchObject({ ok: true });
    expect(readFileSync(join(room.folderOf(first.id('Dara Kim')), 'Report.docx'), 'utf8')).toBe('final');
  });
});
