import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { receiptCode } from '@lib/files/receipt';
import { SimClassroom, type SimOptions } from '../../scripts/class/sim';
import { Discovery, examsAt, namesOf } from '../../src/main/student/discovery';
import { BACKUP_MS } from '../../src/main/student/exam';
import { sendFiles, uploadOf } from '../../src/main/student/files';
import { Session, type SessionEvent } from '../../src/main/student/session';
import { broadcastAddresses } from '../../src/main/teacher/beacon';
import { EARLIER } from '../../src/main/teacher/classroom';
import { later } from './helpers';

const v = 1;
const SEC = 1000;

/** A classroom on this computer, with time 20 times as fast: the 10 s of no contact take half a second. */
async function classroom(options: SimOptions = {}): Promise<SimClassroom> {
  const sim = await SimClassroom.open({ speed: 20, ...options });
  later(() => sim.close());
  return sim;
}

/** A classroom whose exam has started, with everyone in it. */
async function started(options: SimOptions = {}): Promise<SimClassroom> {
  const sim = await classroom(options);
  await sim.everyoneReady();
  await sim.room.start();
  await sim.until(() => sim.students.every((s) => s.session?.state === 'inExam'));
  return sim;
}

const kinds = async (sim: SimClassroom, name?: string) => (await sim.log(name)).map((e) => e.kind);
const url = (sim: SimClassroom, path: string) => `http://127.0.0.1:${sim.server.port}${path}`;

describe('F-01 finding exams on the classroom network', () => {
  it('a lab computer hears the teacher\'s beacon and lists the exam; an ended exam goes off the list', async () => {
    const discovery = new Discovery({ port: 0, staleMs: 400 });
    await discovery.start();
    later(() => discovery.stop());
    const lists: number[] = [];
    discovery.onChange((found) => lists.push(found.length));
    const sim = await classroom({ beacon: { port: discovery.port, targets: ['127.0.0.1'] } });

    await sim.until(() => discovery.found().length === 1);
    expect(discovery.found()[0]).toMatchObject({
      v, runId: sim.room.id, title: 'Year 10 ICT — Term 1 practical exam', teacher: 'Ms Srey Leak', class: 'Year 10 A',
      port: sim.server.port, host: '127.0.0.1', teacherKeyFp: null,
    });
    await sim.room.end();
    await sim.until(() => discovery.found().length === 0);
    await sim.until(() => lists.join() === '1,0');
  });

  it('what isn\'t a beacon of this version is not listed', async () => {
    const discovery = new Discovery({ port: 0 });
    await discovery.start();
    later(() => discovery.stop());
    const sim = await classroom({ beacon: { port: discovery.port, targets: ['127.0.0.1'] } });
    const { createSocket } = await import('node:dgram');
    const socket = createSocket('udp4');
    const send = (text: string) => new Promise((r) => socket.send(Buffer.from(text), discovery.port, '127.0.0.1', r));
    await send('not json');
    await send(JSON.stringify({ hello: 'there' }));
    await send(JSON.stringify({ ...sim.server.listings()[0], v: 99, runId: 'from-the-future' }));
    socket.close();
    await sim.until(() => discovery.found().length === 1);
    expect(discovery.found().map((f) => f.runId)).toEqual([sim.room.id]);
  });

  it('the beacon goes to every network the laptop is on', () => {
    expect(broadcastAddresses({
      lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: null }],
      en0: [
        { address: '192.168.10.23', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: null },
        { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '', internal: false, cidr: null, scopeid: 4 },
      ],
      en5: [{ address: '10.4.7.9', netmask: '255.255.240.0', family: 'IPv4', mac: '', internal: false, cidr: null }],
      gone: undefined,
    })).toEqual(['255.255.255.255', '192.168.10.255', '10.4.15.255']);
    expect(broadcastAddresses()).toContain('255.255.255.255');
  });

  it('with the teacher\'s computer name typed in, its exams are listed without the beacon (R3)', async () => {
    const sim = await classroom();
    expect(await examsAt('127.0.0.1', sim.server.port)).toMatchObject([{ runId: sim.room.id, host: '127.0.0.1', port: sim.server.port }]);
    expect(await examsAt('127.0.0.1', 9)).toEqual([]);
    expect(await examsAt('127.0.0.1', sim.server.port, Date.now, async () => Response.json({ not: 'a list' }))).toEqual([]);
  });

  it('F-02 the class list of an exam is there to pick a name from, until the exam has ended', async () => {
    const sim = await classroom({ students: ['Sokha Chan', 'Dara Kim'] });
    const exam = { host: '127.0.0.1', port: sim.server.port, runId: sim.room.id };
    expect((await namesOf(exam)).map((s) => s.name)).toEqual(['Dara Kim', 'Sokha Chan']);
    expect(await namesOf({ ...exam, runId: 'no-such-run' })).toEqual([]);
    await sim.room.end();
    expect(await namesOf(exam)).toEqual([]);
  });
});

describe('F-02 F-03 F-08 joining over the network', () => {
  it('a student joins, passes the checks, locks, and is in the exam at Start, knowing when it ends', async () => {
    const sim = await classroom();
    const dara = sim.student('Dara Kim');
    expect(await dara.join()).toBe('joined');
    expect(dara.session).toMatchObject({ state: 'checking', token: expect.any(String) });
    await sim.until(() => sim.view('Dara Kim').state === 'checking');
    dara.session!.checks([{ check: 'oneScreen', ok: true }]);
    dara.session!.ready();
    await sim.until(() => sim.view('Dara Kim').state === 'ready');

    const heard: SessionEvent[] = [];
    dara.session!.on((e) => heard.push(e));
    await sim.room.start();
    await sim.until(() => dara.session!.state === 'inExam');
    const { startedAt, endsAt } = sim.room.view().run;
    expect(endsAt).toBe(startedAt! + 90 * 60 * SEC);
    expect(heard).toEqual([{ type: 'state', state: 'inExam', reason: undefined }, { type: 'endsAt', endsAt }]);
    expect(dara.session!.endsAt).toBe(endsAt);
    // this computer's idea of the teacher's clock is the teacher's clock, to within the time a message takes
    // (time runs 20 times as fast here, and so does the error: 10 s is half a second)
    expect(Math.abs(dara.session!.teacherNow() - sim.clock.now())).toBeLessThan(10 * SEC);
    await sim.until(() => existsSync(dara.folder));
  });

  it('F-03 a wrong code is refused; F-02 so are a name that isn\'t in the class and one that is taken', async () => {
    const sim = await classroom();
    const [sokha, dara] = [sim.student('Sokha Chan'), sim.student('Dara Kim')];
    expect(await sokha.join({ code: '0000' })).toBe('codeWrong');
    expect(sokha.session).toMatchObject({ state: 'refused', reason: 'codeWrong' });
    expect(await sokha.join({ studentId: 'not-in-the-class' })).toBe('notInClass');
    expect(await dara.join()).toBe('joined');
    // Sokha picks Dara's name on another computer
    expect(await sokha.join({ studentId: dara.id })).toBe('nameTaken');
    expect(sim.view('Dara Kim')).toMatchObject({ state: 'checking', pc: dara.pc, connected: true });
  });

  it('F-08 a late joiner is in the exam as soon as their computer is locked, with the time that is left', async () => {
    const sim = await classroom({ students: ['Sokha Chan', 'Dara Kim'] });
    await sim.student('Sokha Chan').sit();
    await sim.until(() => sim.view('Sokha Chan').state === 'ready');
    await sim.room.start();
    const dara = sim.student('Dara Kim');
    await dara.sit();
    await sim.until(() => dara.session!.state === 'inExam');
    expect(dara.session!.endsAt).toBe(sim.room.view().run.endsAt);
    expect((await kinds(sim, 'Dara Kim')).at(-1)).toBe('joinedLate');
  });

  it('an exam that isn\'t open, or a teacher\'s laptop that can\'t be reached, is said so', async () => {
    const sim = await classroom();
    const dara = sim.student('Dara Kim');
    sim.server.remove(sim.room.id);
    expect(await dara.join()).toBe('ended');
    dara.unplugged = true;
    expect(await dara.join()).toBe('unreachable');
    expect(dara.session!.state).toBe('closed');
  });

  it('§2.7 an ExamMode of another version is told to update; what isn\'t a message is ignored', async () => {
    const sim = await classroom();
    const talk = (path: string) => new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${sim.server.port}${path}`);
      ws.once('open', () => resolve(ws)).once('error', reject);
    });
    const next = (ws: WebSocket) => new Promise<unknown>((r) => ws.once('message', (data) => r(JSON.parse(String(data)))));
    const closed = (ws: WebSocket) => new Promise((r) => ws.once('close', r));

    const old = await talk('/ws');
    const reply = next(old);
    old.send('{ not json');
    old.send(JSON.stringify({ v, type: 'no-such-message' }));
    old.send(JSON.stringify({ v, type: 'ready' }));
    old.send(JSON.stringify({ v: 0, type: 'join', runId: sim.room.id, studentId: 'x', code: '4817', pc: 'PC-01', instanceId: 'i', bootId: 'b' }));
    expect(await reply).toEqual({ v, type: 'refused', reason: 'update' });
    await closed(old);

    const lost = await talk('/ws');
    const answer = next(lost);
    lost.send(JSON.stringify({ v, type: 'resume', token: 'made-up', instanceId: 'i', localLog: [] }));
    expect(await answer).toEqual({ v, type: 'refused', reason: 'notJoined' });
    await closed(lost);

    await expect(talk('/elsewhere')).rejects.toThrow();
    expect((await fetch(url(sim, '/elsewhere'))).status).toBe(404);
  });

  it('a teacher\'s laptop of a newer version tells the student to update', async () => {
    const { WebSocketServer } = await import('ws');
    const newer = new WebSocketServer({ port: 0 });
    later(() => new Promise<void>((r) => newer.close(() => r())));
    newer.on('connection', (ws) => ws.on('message', () => {
      ws.send('{ not json');
      ws.send(JSON.stringify({ v: 2, type: 'joined', token: 't', now: 0, state: 'checking' }));
    }));
    await new Promise((r) => newer.once('listening', r));
    const port = (newer.address() as { port: number }).port;
    const session = new Session({ host: '127.0.0.1', port, runId: 'r', studentId: 's', code: '4817', pc: 'PC-01', instanceId: 'i', bootId: 'b' });
    expect(await session.join()).toBe('update');
    expect(session).toMatchObject({ state: 'refused', reason: 'update' });
  });
});

describe('F-18 F-19 F-20 over the network', () => {
  it('F-19 the network drops for 45 s: no contact, then in the exam again with the gap and its own record; nothing lost', async () => {
    const sim = await started();
    const mealea = sim.student('Mealea Heng');
    await mealea.write('Report.docx', 'before the gap');
    mealea.unplug();
    await sim.until(() => mealea.session!.state === 'noContact');
    await sim.until(() => sim.view('Mealea Heng').state === 'noContact');
    // still working, and ExamMode still watching, while the network is gone
    await mealea.write('Report.docx', 'written during the gap');
    mealea.session!.report('appClosed', { app: 'Chrome' });
    expect(await mealea.exam!.backUp()).toBe(-1);
    await sim.clock.wait(30 * SEC);
    expect(sim.view('Mealea Heng').state).toBe('noContact');

    mealea.plug();
    await sim.until(() => mealea.session!.state === 'inExam');
    await sim.until(() => sim.view('Mealea Heng').state === 'inExam');
    const log = await sim.log('Mealea Heng');
    expect(log.map((e) => e.kind).slice(-2)).toEqual(['noContact', 'gap']);
    const gap = log.at(-1)!.details as { seconds: number; localLog: { kind: string; details: unknown }[] };
    expect(gap.seconds).toBeGreaterThanOrEqual(30);
    expect(gap.localLog.map((e) => e.kind)).toEqual(['contactLost', 'appClosed']);
    expect(gap.localLog[1]!.details).toEqual({ app: 'Chrome' });
    // nobody else was touched, and the work is backed up as soon as there is contact
    expect(sim.room.view().students.filter((s) => s.state === 'inExam')).toHaveLength(4);
    expect(await mealea.exam!.backUp()).toBe(1);
    expect(readFileSync(join(sim.room.folderOf(mealea.id), 'Report.docx'), 'utf8')).toBe('written during the gap');
  });

  it('F-19 a short drop, under 10 s, is nothing: the same ExamMode is simply back', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    const token = dara.session!.token;
    dara.unplug();
    await sim.until(() => dara.session!.state === 'noContact');
    dara.plug();
    await sim.until(() => dara.session!.state === 'inExam');
    expect(dara.session!.token).toBe(token);
    expect(await kinds(sim, 'Dara Kim')).toEqual(['joined', 'ready', 'started']);
  });

  it('F-20 ExamMode is killed: left (stopped suddenly) at once; joining from another computer is refused; Let back in opens the exam there', async () => {
    const sim = await started();
    const vannak = sim.student('Vannak Sok');
    const end = sim.room.view().run.endsAt;
    await vannak.kill();
    expect(sim.view('Vannak Sok')).toMatchObject({ state: 'left', leftHow: 'stoppedSuddenly' });

    expect(await vannak.join({ pc: 'PC-30' })).toBe('left');
    expect(vannak.session).toMatchObject({ state: 'waiting', reason: 'left' });
    await sim.until(() => sim.view('Vannak Sok').asksBackFrom === 'PC-30');

    await sim.room.letBackIn(vannak.id, 'his computer froze');
    await sim.until(() => vannak.session!.state === 'inExam');
    expect(vannak.session!.endsAt).toBe(end);
    expect(sim.view('Vannak Sok')).toMatchObject({ state: 'inExam', pc: 'PC-30', connected: true });
    expect((await kinds(sim, 'Vannak Sok')).slice(-4)).toEqual(['stoppedSuddenly', 'asksBack', 'letBackIn', 'cameBack']);
  });

  it('F-40 Keep out: the waiting student is told, and ExamMode stops asking', async () => {
    const sim = await started();
    const vannak = sim.student('Vannak Sok');
    await vannak.kill();
    await vannak.join();
    await sim.room.keepOut(vannak.id, 'was seen with a phone');
    await sim.until(() => vannak.session!.state === 'refused');
    expect(vannak.session!.reason).toBe('keptOut');
  });

  it('F-18 a waiting student whose connection drops keeps asking', async () => {
    const sim = await started();
    const vannak = sim.student('Vannak Sok');
    await vannak.kill();
    await vannak.join();
    vannak.session!.drop();
    await sim.clock.wait(5 * SEC);
    expect(vannak.session!.state).toBe('waiting');
    await sim.room.letBackIn(vannak.id, 'ok');
    await sim.until(() => vannak.session!.state === 'inExam');
  });

  it('F-20 the computer is switched off and on: the new ExamMode is refused, and the log says it was restarted', async () => {
    const sim = await started();
    const vannak = sim.student('Vannak Sok');
    await vannak.reboot();
    expect(await vannak.join()).toBe('left');
    const stopped = (await sim.log('Vannak Sok')).find((e) => e.kind === 'stoppedSuddenly');
    expect(stopped?.details).toEqual({ restarted: true });
  });

  it('F-19 while one ExamMode has no contact, another joins as the same student: the first comes back to find it left', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    const first = dara.session!;
    dara.unplug();
    await sim.until(() => sim.view('Dara Kim').state === 'noContact');
    dara.plug();
    // (the simulated student keeps one session; the first is still running and comes back by itself)
    const second = dara.join({ pc: 'PC-31' });
    await sim.until(() => first.state === 'waiting' || first.state === 'refused');
    expect(await second).toBe('left');
    expect(sim.view('Dara Kim')).toMatchObject({ state: 'left', leftHow: 'stoppedSuddenly' });
    first.close();
  });

  it('F-18 ExamMode crashes in the lobby before Start: off the list after 10 s, and the student joins again normally', async () => {
    const sim = await classroom();
    const dara = sim.student('Dara Kim');
    await dara.sit();
    await sim.until(() => sim.view('Dara Kim').state === 'ready');
    await dara.kill(false);
    await sim.until(() => sim.view('Dara Kim').state === 'notJoined');
    await dara.sit();
    await sim.until(() => sim.view('Dara Kim').state === 'ready');
    expect(await kinds(sim, 'Dara Kim')).toEqual(['joined', 'ready', 'leftBeforeStart', 'joined', 'ready']);
  });

  it('F-18 a lobby student whose network was gone for longer than 10 s is taken back as a new arrival', async () => {
    const sim = await classroom();
    const dara = sim.student('Dara Kim');
    await dara.sit();
    await sim.until(() => sim.view('Dara Kim').state === 'ready');
    dara.unplug();
    await sim.until(() => sim.view('Dara Kim').state === 'notJoined');
    dara.plug();
    await sim.until(() => dara.session!.state === 'checking');
    expect(sim.view('Dara Kim')).toMatchObject({ state: 'checking', connected: true });
  });

  it('F-20 the Guard\'s stopped is taken only with an attempt\'s token', async () => {
    const sim = await started();
    const post = (body: unknown) => fetch(url(sim, '/stopped'), { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
    const stopped = { v, type: 'stopped', token: 'made-up', pc: 'PC-01', instanceId: 'i', at: 0 };
    expect((await post(stopped)).status).toBe(404);
    expect((await post({ ...stopped, token: undefined })).status).toBe(400);
    expect((await post('{ not json')).status).toBe(400);
    expect((await post('x'.repeat(20_000))).status).toBe(400);
    expect(sim.room.view().students.every((s) => s.state === 'inExam')).toBe(true);
  });
});

describe('F-16 F-17 F-22 files over the network', () => {
  it('F-22 the changed files go to the teacher\'s laptop by themselves, every 2 minutes', async () => {
    expect(BACKUP_MS).toBe(120_000);
    // (every 10 s here, so the test needn't wait)
    const sim = await started({ backupMs: 10 * SEC });
    const dara = sim.student('Dara Kim');
    const folder = sim.room.folderOf(dara.id);
    const backups: number[] = [];
    dara.exam!.on((e) => e.type === 'backedUp' && backups.push(e.files));
    await dara.write('Report.docx', 'first draft');
    await dara.write('site/index.html', '<h1>Hello</h1>');
    await dara.write('~$Report.docx', 'Word\'s lock file');
    await sim.until(() => existsSync(join(folder, 'site', 'index.html')));
    expect(readFileSync(join(folder, 'Report.docx'), 'utf8')).toBe('first draft');
    expect(existsSync(join(folder, '~$Report.docx'))).toBe(false);

    await dara.write('Report.docx', 'second draft, longer');
    await sim.until(() => readFileSync(join(folder, 'Report.docx'), 'utf8') === 'second draft, longer');
    await sim.until(() => backups.join() === '2,1');
    expect(await dara.exam!.backUp()).toBe(0);
  });

  it('F-16 Hand in: the files are checked by SHA-256, the receipt is the same on both sides, and the Exam folder is removed', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    await dara.write('Report.docx', 'my report');
    await dara.write('code/main.py', 'print("hello")');
    const receipt = await dara.handIn();
    expect(receipt?.files.map((f) => f.name)).toEqual(['code/main.py', 'Report.docx']);
    expect(receipt?.code).toBe(await receiptCode(sim.room.id, dara.id, receipt!.files));
    expect(sim.view('Dara Kim')).toMatchObject({ state: 'handedIn', handedInHow: 'handIn', receipt: receipt!.code });
    expect(dara.session!.state).toBe('handedIn');
    expect(dara.exam!.receipt).toEqual(receipt);
    const folder = sim.room.folderOf(dara.id);
    expect(readFileSync(join(folder, 'Report.docx'), 'utf8')).toBe('my report');
    expect(readFileSync(join(folder, 'code', 'main.py'), 'utf8')).toBe('print("hello")');
    expect(existsSync(dara.folder)).toBe(false);
    // asking again gives the same receipt
    expect(await dara.handIn()).toEqual(receipt);
    expect(existsSync(join(sim.root, 'Hand-ins', '.incoming', 'x'))).toBe(false);
  });

  it('F-17 at time up every student\'s work is handed in by itself, marked time up', async () => {
    const sim = await classroom({ minutes: 1 });
    await sim.everyoneReady();
    await sim.room.start();
    await sim.until(() => sim.students.every((s) => s.session?.state === 'inExam'));
    await Promise.all(sim.students.map((s) => s.write('answer.txt', `by ${s.name}`)));
    await sim.until(() => sim.room.view().students.every((s) => s.state === 'handedIn'), 15_000);
    for (const s of sim.students) {
      expect(sim.view(s.name)).toMatchObject({ handedInHow: 'timeUp', receipt: expect.stringMatching(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/) });
      expect(readFileSync(join(sim.room.folderOf(s.id), 'answer.txt'), 'utf8')).toBe(`by ${s.name}`);
    }
  });

  it('F-17 a lab computer whose clock runs ahead waits for the teacher\'s laptop to say the time is up: still marked time up', async () => {
    const sim = await classroom({ minutes: 1, students: ['Sokha Chan', 'Dara Kim'] });
    await sim.everyoneReady();
    await sim.room.start();
    const dara = sim.student('Dara Kim');
    await sim.until(() => dara.session!.state === 'inExam');
    dara.fast = 3 * SEC;
    await sim.until(() => sim.room.view().students.every((s) => s.state === 'handedIn'), 15_000);
    expect(sim.view('Dara Kim').handedInHow).toBe('timeUp');
    expect(sim.view('Sokha Chan').handedInHow).toBe('timeUp');
  });

  it('F-41 End the exam collects everyone\'s work; a student with extra time isn\'t cut off at the others\' end', async () => {
    const sim = await classroom({ minutes: 1, students: ['Sokha Chan', 'Dara Kim'] });
    await sim.everyoneReady();
    await sim.room.start();
    await sim.room.addTime(30, sim.student('Dara Kim').id);
    await sim.until(() => sim.view('Sokha Chan').state === 'handedIn', 15_000);
    await sim.clock.wait(10 * SEC);
    expect(sim.view('Dara Kim').state).toBe('inExam');
    expect(sim.student('Dara Kim').session!.endsAt).toBe(sim.view('Dara Kim').endsAt);
    await sim.room.end();
    await sim.until(() => sim.view('Dara Kim').state === 'handedIn');
    expect(sim.view('Dara Kim').handedInHow).toBe('ended');
    expect(sim.view('Sokha Chan').handedInHow).toBe('timeUp');
  });

  it('F-19 a hand-in with no contact keeps trying, and goes through when the network is back', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    await dara.write('Report.docx', 'finished offline');
    dara.unplug();
    const handingIn = dara.handIn();
    await sim.clock.wait(15 * SEC);
    expect(sim.view('Dara Kim').state).toBe('noContact');
    dara.plug();
    expect((await handingIn)?.files.map((f) => f.name)).toEqual(['Report.docx']);
    expect(sim.view('Dara Kim')).toMatchObject({ state: 'handedIn', handedInHow: 'handIn' });
  });

  it('F-15 Leave: the work so far goes to the teacher first, as it is, and counts as the hand-in', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    await dara.write('Report.docx', 'half done');
    await dara.exam!.leave();
    await sim.until(() => sim.view('Dara Kim').state === 'left');
    expect(sim.view('Dara Kim').leftHow).toBe('pressedLeave');
    expect(dara.session!.state).toBe('left');
    expect(readFileSync(join(sim.room.folderOf(dara.id), 'Report.docx'), 'utf8')).toBe('half done');
    expect(existsSync(dara.folder)).toBe(false);
    // after leaving, the teacher's laptop takes nothing more
    expect(await dara.handIn()).toBeUndefined();
  });

  it('F-15 leaving with no contact: the Exam folder stays on the lab computer, as the teacher doesn\'t have the work', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    await dara.write('Report.docx', 'half done');
    dara.unplug();
    await dara.exam!.leave();
    expect(existsSync(join(dara.folder, 'Report.docx'))).toBe(true);
  });

  it('a hand-in that the teacher\'s laptop refuses is given up, and the student\'s files stay', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    await dara.write('Report.docx', 'mine');
    let refused = 0;
    dara.exam!.on((e) => e.type === 'handInRefused' && refused++);
    await sim.room.receive({ send: () => undefined, close: () => undefined }, { v, type: 'join', runId: sim.room.id, studentId: dara.id, code: sim.code, pc: dara.pc, instanceId: 'another-examMode', bootId: 'b' });
    expect(sim.view('Dara Kim').state).toBe('left');
    expect(await dara.handIn()).toBeUndefined();
    expect(refused).toBe(1);
    expect(existsSync(join(dara.folder, 'Report.docx'))).toBe(true);
  });

  it('N-05 files are taken only with a token, only as announced, and only inside the student\'s folder', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    await dara.write('Report.docx', 'good');
    await dara.exam!.backUp();
    const base = url(sim, '');
    const token = dara.session!.token!;
    const good = { name: 'Report.docx', bytes: 4, sha256: '770e607624d689265ca6c44884d0807d9b054d23c473c106c72be9de08b7376c' };
    const status = async (files: typeof good[], t = token) => {
      const sent = await sendFiles(base, uploadOf(t, 'backup', files), dara.folder);
      return sent.ok ? 200 : sent.status;
    };
    expect(await status([good])).toBe(200);
    expect(await status([good], 'made-up')).toBe(401);
    expect(await status([{ ...good, sha256: 'a'.repeat(64) }])).toBe(422);
    expect(readFileSync(join(sim.room.folderOf(dara.id), 'Report.docx'), 'utf8')).toBe('good');

    const post = (form: FormData | string) => fetch(`${base}/upload`, { method: 'POST', body: form });
    const form = (...parts: [string, string | Blob][]) => {
      const f = new FormData();
      for (const [name, value] of parts) f.set(name, value);
      return f;
    };
    const meta = JSON.stringify(uploadOf(token, 'backup', [{ ...good, name: '../Sokha Chan/Report.docx' }]));
    expect((await post(form(['meta', meta], ['f0', new Blob(['good'])]))).status).toBe(422);
    expect(existsSync(join(sim.room.folderOf(sim.student('Sokha Chan').id), 'Report.docx'))).toBe(false);
    // the files before saying who sends them; no meta at all; a meta that isn't one; not a form
    expect((await post(form(['f0', new Blob(['good'])], ['meta', meta]))).status).toBe(400);
    expect((await post(form(['other', 'x']))).status).toBe(400);
    expect((await post(form(['meta', '{ not json']))).status).toBe(400);
    expect((await post(form(['meta', JSON.stringify({ v, token })]))).status).toBe(400);
    expect((await post('just text')).status).toBe(400);
    // more files than announced are not kept
    expect((await post(form(['meta', JSON.stringify(uploadOf(token, 'backup', [good]))], ['f0', new Blob(['good'])], ['f7', new Blob(['extra'])], ['x', new Blob(['extra'])]))).status).toBe(200);

    // before Start nothing is taken
    const lobby = await classroom();
    await lobby.student('Dara Kim').sit();
    const early = await sendFiles(url(lobby, ''), uploadOf(lobby.student('Dara Kim').session!.token!, 'backup', [good]), dara.folder);
    expect(early).toEqual({ ok: false, status: 409 });
  });

  it('a backup of a file that is deleted before the hand-in is kept apart on the teacher\'s laptop', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    await dara.write('scrap.txt', 'never mind');
    await dara.write('Report.docx', 'final');
    await dara.exam!.backUp();
    const { rm } = await import('node:fs/promises');
    await rm(join(dara.folder, 'scrap.txt'));
    await dara.handIn();
    const folder = sim.room.folderOf(dara.id);
    expect(existsSync(join(folder, 'scrap.txt'))).toBe(false);
    expect(readFileSync(join(folder, EARLIER, 'scrap.txt'), 'utf8')).toBe('never mind');
  });
});
