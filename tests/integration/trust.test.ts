import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { ExamForm } from '@lib/app/state';
import { PROTOCOL_VERSION } from '@lib/protocol/messages';
import { newKeyPair } from '../../src/trust/keys';
import { issue } from '../../src/trust/licence';
import { type Trust } from '@lib/trust/licence';
import { signMessage, type Identity } from '../../src/trust/signed';
import { StudentExam } from '../../src/main/student/exam';
import { StudentFlow } from '../../src/main/student/flow';
import { Session } from '../../src/main/student/session';
import { TeacherDesk } from '../../src/main/teacher/desk';
import { eventually, later, tempFolder } from './helpers';

const author = newKeyPair();
const trust: Trust = { authorKeys: [author.publicKey] };
const identity = (name: string, by = author.privateKey): Identity => {
  const keys = newKeyPair();
  return { privateKey: keys.privateKey, licence: issue({ name, school: 'Riverside High School', key: keys.publicKey }, '0042', 1, by) };
};
const FORM: ExamForm = { teacher: 'Ms Srey Leak', title: 'Term 1', className: 'Year 10 A', studentNames: 'Sokha Chan\nDara Kim', minutes: 90, websites: [] };

/** A teacher's laptop and a lab computer that believes only the author's licences. */
async function room(teacher?: Identity, believes: Trust = trust) {
  const root = await tempFolder();
  const flow = new StudentFlow({ pc: 'PC-14', examRoot: join(root, 'Exam'), bootId: 'boot', remember: join(root, 'exam.json'), discoveryPort: 0, trust: believes, timing: { beatMs: 40, retryMs: 40, clockMs: 20, graceMs: 40 } });
  await flow.start();
  later(() => flow.stop());
  const desk = await TeacherDesk.open({ db: join(root, 'exammode.db'), handIns: join(root, 'Hand-ins'), port: 0, tickMs: 30, identity: teacher, beacon: { everyMs: 50, port: flow.discoveryPort, targets: () => ['127.0.0.1'] } });
  later(() => desk.close());
  expect(await desk.openExam(FORM)).toBeUndefined();
  return { root, flow, desk };
}

describe('F-44 only a licensed teacher\'s exam, and only that teacher\'s laptop', () => {
  const teacher = identity('Srey Leak');

  it('a licensed teacher\'s exam is listed, joined, started and handed in — every answer signed and checked', async () => {
    const { flow, desk } = await room(teacher);
    await eventually(() => expect(flow.state().found).toMatchObject([{ title: 'Term 1', teacherKey: teacher.licence.key }]));
    await flow.pick(flow.state().found[0]!.runId);
    await flow.join(flow.state().names.find((n) => n.name === 'Sokha Chan')!.id, desk.state().run!.code);
    await eventually(() => expect(desk.state().students.find((s) => s.name === 'Sokha Chan')!.state).toBe('ready'));
    await desk.start();
    await eventually(() => expect(flow.state().screen).toBe('exam'));
    expect(flow.session!.ignored).toBe(0);

    // (the Exam folder is made as the exam starts)
    await flow.exam!.begin();
    const folder = flow.exam!.files.folder;
    await writeFile(join(folder, 'Report.docx'), 'my work');
    expect(await flow.exam!.backUp()).toBe(1);
    await flow.askHandIn();
    await flow.handIn();
    await eventually(() => expect(flow.state().screen).toBe('handedIn'));
    await eventually(async () => expect(await readFile(join(desk.folder!, 'Sokha Chan', 'Report.docx'), 'utf8')).toBe('my work'));
    expect(flow.session!.ignored).toBe(0);
  });

  it('F-44 a beacon signed by an unlicensed key isn\'t listed — nor is that laptop\'s exam found by its name', async () => {
    const { flow, desk } = await room(identity('Fake Teacher', newKeyPair().privateKey));
    await new Promise((r) => setTimeout(r, 300));
    expect(flow.state().found).toEqual([]);
    Object.assign(flow, { options: { ...flow['options'], teacherPort: desk.port } });
    await flow.lookAt('127.0.0.1');
    expect(flow.state()).toMatchObject({ found: [], joinError: 'unreachable' });
  });

  it('a teacher with no licence at all is listed only by a development build', async () => {
    const strict = await room(undefined);
    await new Promise((r) => setTimeout(r, 300));
    expect(strict.flow.state().found).toEqual([]);
    const dev = await room(undefined, { authorKeys: [author.publicKey], allowUnsigned: true });
    await eventually(() => expect(dev.flow.state().found).toHaveLength(1));
    expect(dev.flow.state().found[0]!.teacherKey).toBeUndefined();
  });
});

describe('F-44 after joining, only the pinned teacher\'s messages count', () => {
  const teacher = identity('Srey Leak');
  const other = identity('Another Teacher');
  const servers: WebSocketServer[] = [];
  afterEach(() => servers.splice(0).forEach((s) => s.close()));

  /** A laptop that answers a join, and then says whatever the test makes it say. */
  async function laptop() {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await new Promise((r) => server.once('listening', r));
    const joined = new Promise<{ nonce: string; say: (msg: object) => void }>((resolve) => {
      server.on('connection', (ws) => ws.on('message', (data) => {
        const msg = JSON.parse(String(data)) as { type: string; nonce: string };
        if (msg.type === 'join') resolve({ nonce: msg.nonce, say: (m) => ws.send(JSON.stringify(m)) });
      }));
    });
    const session = new Session({ host: '127.0.0.1', port: (server.address() as { port: number }).port, teacherKey: teacher.licence.key, runId: 'r-1', studentId: 's-1', code: '1234', pc: 'PC-14', instanceId: 'i-1', bootId: 'b-1', beatMs: 1000, retryMs: 1000 });
    later(() => session.close());
    const answer = session.join();
    return { session, answer, ...(await joined) };
  }
  const v = PROTOCOL_VERSION;
  const welcome = { v, type: 'joined', token: 'token-1', now: Date.now(), state: 'ready' };

  it('F-44 after joining, a message signed by another teacher\'s key is ignored', async () => {
    const { session, answer, nonce, say } = await laptop();
    say(signMessage(welcome, nonce, 0, teacher.privateKey));
    expect(await answer).toBe('joined');
    // another licensed teacher's laptop says: the exam started; hand in now; you are refused
    say(signMessage({ v, type: 'start', endsAt: Date.now() + 60_000 }, nonce, 1, other.privateKey));
    say(signMessage({ v, type: 'end' }, nonce, 2, other.privateKey));
    say(signMessage({ v, type: 'refused', reason: 'keptOut' }, nonce, 3, other.privateKey));
    // … with no signature at all; … a newer version's word, which would otherwise say "update ExamMode"
    say({ v, type: 'start', endsAt: Date.now() + 60_000 });
    say({ v: v + 1, type: 'anything' });
    await eventually(() => expect(session.ignored).toBe(5));
    expect(session.state).toBe('ready');
    // the real teacher's Start still counts
    say(signMessage({ v, type: 'start', endsAt: Date.now() + 60_000 }, nonce, 1, teacher.privateKey));
    await eventually(() => expect(session.state).toBe('inExam'));
  });

  it('the teacher\'s own message played a second time is ignored', async () => {
    const { session, answer, nonce, say } = await laptop();
    say(signMessage(welcome, nonce, 0, teacher.privateKey));
    expect(await answer).toBe('joined');
    const ends: number[] = [];
    session.on((e) => void (e.type === 'endsAt' && ends.push(e.endsAt)));
    const start = signMessage({ v, type: 'start', endsAt: 5_000_000_000_000 }, nonce, 1, teacher.privateKey);
    say(start);
    say(signMessage({ v, type: 'time', endsAt: 5_000_000_600_000 }, nonce, 2, teacher.privateKey));
    say(start);
    await eventually(() => expect(session.ignored).toBe(1));
    expect(ends).toEqual([5_000_000_000_000, 5_000_000_600_000]);
  });

  it('a join answered by a laptop that isn\'t the teacher\'s never joins', async () => {
    const { session, nonce, say } = await laptop();
    say(signMessage(welcome, nonce, 0, other.privateKey));
    say(welcome);
    await eventually(() => expect(session.ignored).toBe(2));
    expect(session.state).toBe('joining');
    expect(session.token).toBeUndefined();
  });

  it('"got your files" from anyone but the teacher\'s laptop is no answer: nothing counts as backed up or handed in', async () => {
    const { session, answer, nonce, say } = await laptop();
    say(signMessage({ ...welcome, state: 'inExam', endsAt: Date.now() + 60_000 }, nonce, 0, teacher.privateKey));
    expect(await answer).toBe('joined');
    const folder = join(await tempFolder(), 'Exam');
    await mkdir(folder, { recursive: true });
    let asked = 0;
    // a laptop in between answers every upload with a plain yes, and a receipt of its own making
    const send = (async () => {
      asked++;
      return new Response(JSON.stringify({ v, ok: true, type: 'receipt', code: 'ABC-DEF', files: [] }), { status: 200 });
    }) as typeof fetch;
    const work = new StudentExam(session, { folder, backupMs: 60_000, retryMs: 20, send });
    later(() => work.stop());
    await work.begin();
    await writeFile(join(folder, 'Report.docx'), 'my work');
    expect(await work.backUp()).toBe(-1);
    let done = false;
    void work.handIn().then(() => void (done = true));
    await eventually(() => expect(asked).toBeGreaterThan(3));
    expect(done).toBe(false);
    // the work is still on this computer
    expect(await readFile(join(folder, 'Report.docx'), 'utf8')).toBe('my work');
  });
});
