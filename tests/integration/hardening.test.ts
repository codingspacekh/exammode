import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { SimClassroom, type SimOptions } from '../../scripts/class/sim';
import { hashFile, uploadOf } from '../../src/main/student/files';
import { WRONG_CODES } from '../../src/main/teacher/classroom';
import { later } from './helpers';

/**
 * What a computer on the classroom network can't do to the teacher's laptop (the review before v1.0): stop it,
 * fill its log or its disk, hold its connections, or put a classmate out of the exam.
 */
const v = 1;
async function started(options: SimOptions = {}): Promise<SimClassroom> {
  const sim = await SimClassroom.open({ speed: 20, ...options });
  later(() => sim.close());
  await sim.everyoneReady();
  await sim.room.start();
  await sim.until(() => sim.students.every((s) => s.session?.state === 'inExam'));
  return sim;
}
const url = (sim: SimClassroom, path: string) => `http://127.0.0.1:${sim.server.port}${path}`;
const kinds = async (sim: SimClassroom) => (await sim.log()).map((e) => e.kind);
/** Sends raw bytes to the server and waits until it hangs up, or for a moment. */
const raw = (sim: SimClassroom, text: string, endAfter = true): Promise<string> => new Promise((resolve) => {
  const socket = connect(sim.server.port, '127.0.0.1', () => {
    socket.write(text);
    if (endAfter) socket.end();
  });
  let got = '';
  socket.on('data', (d) => void (got += String(d)));
  socket.on('close', () => resolve(got));
  socket.on('error', () => resolve(got));
  setTimeout(() => { socket.destroy(); resolve(got); }, 1500);
});

describe('the teacher\'s laptop can\'t be stopped by what a stranger sends', () => {
  it('an upgrade request with an address that can\'t be read is hung up on, and the exam goes on', async () => {
    const sim = await started();
    await raw(sim, 'GET // HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
    expect((await fetch(url(sim, '/exams'))).status).toBe(200);
    expect(sim.room.view().students.every((s) => s.state === 'inExam')).toBe(true);
  });

  it('an upload cut off in the middle of a file — before saying who sends it, or after — is refused, not thrown', async () => {
    const sim = await started();
    const boundary = 'xxBOUNDARYxx';
    const head = `POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n`;
    const part = `--${boundary}\r\nContent-Disposition: form-data; name="f0"; filename="file"\r\nContent-Type: application/octet-stream\r\n\r\nhalf a fi`;
    const chunk = (text: string) => `${text.length.toString(16)}\r\n${text}\r\n`;
    // the body ends (a last, empty chunk) while a file is still open
    expect(await raw(sim, `${head}${chunk(part)}0\r\n\r\n`, false)).toMatch(/^HTTP\/1\.1 400/);
    const token = sim.student('Dara Kim').session!.token!;
    const meta = `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(uploadOf(token, 'backup', [{ name: 'a.txt', bytes: 100, sha256: 'a'.repeat(64) }]))}\r\n`;
    expect(await raw(sim, `${head}${chunk(meta + part)}0\r\n\r\n`, false)).toMatch(/^HTTP\/1\.1 400/);
    expect((await fetch(url(sim, '/exams'))).status).toBe(200);
    // nothing of it was kept
    expect(existsSync(join(sim.room.folderOf(sim.student('Dara Kim').id), 'a.txt'))).toBe(false);
  });

  it('a connection that doesn\'t ask to join is closed; one that joined stays', async () => {
    const sim = await started({ server: { joinWithinMs: 150 } });
    const idle = new WebSocket(`ws://127.0.0.1:${sim.server.port}/ws`);
    const closed = new Promise<void>((resolve) => idle.on('close', () => resolve()));
    await closed;
    await new Promise((r) => setTimeout(r, 200));
    expect(sim.students.every((s) => s.session?.state === 'inExam')).toBe(true);
  });
});

describe('the log and the disk can\'t be filled', () => {
  it('wrong codes from a computer that is made to wait aren\'t written down again', async () => {
    const sim = await SimClassroom.open({ speed: 20 });
    later(() => sim.close());
    const join = { v, type: 'join', runId: sim.room.id, studentId: sim.student('Dara Kim').id, code: '0000', pc: 'PC-99', instanceId: 'i', bootId: 'b' } as const;
    const link = { send: () => undefined, close: () => undefined, from: '10.0.0.99' };
    for (let i = 0; i < 200; i++) await sim.room.receive(link, join);
    expect((await kinds(sim)).filter((k) => k === 'codeWrong')).toHaveLength(WRONG_CODES);
  });

  it('a message with a word or a list that is too long isn\'t taken', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    const before = (await sim.log()).length;
    const ws = new WebSocket(`ws://127.0.0.1:${sim.server.port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ v, type: 'join', runId: sim.room.id, studentId: dara.id, code: '0000', pc: 'x'.repeat(5000), instanceId: 'i', bootId: 'b' }));
    ws.send(JSON.stringify({ v, type: 'resume', token: dara.session!.token, instanceId: 'i', localLog: Array.from({ length: 5000 }, () => ({ at: 1, kind: 'appClosed', details: {} })) }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
    // … nor an event with a book in it, from a student who is in the exam
    dara.session!.report('appClosed', { app: 'x'.repeat(10_000) });
    await new Promise((r) => setTimeout(r, 200));
    expect((await sim.log()).length).toBe(before);
  });

  it('a student\'s files stop being taken at the limit for one student; the others\' still are', async () => {
    const sim = await started({ room: { maxBytesPerStudent: 1000 } });
    const dara = sim.student('Dara Kim');
    await dara.write('small.txt', 'a'.repeat(600));
    expect(await dara.exam!.backUp()).toBe(1);
    await dara.write('more.txt', 'b'.repeat(600));
    expect(await dara.exam!.backUp()).toBe(-1);
    expect(existsSync(join(sim.room.folderOf(dara.id), 'more.txt'))).toBe(false);
    const sokha = sim.student('Sokha Chan');
    await sokha.write('small.txt', 'c'.repeat(600));
    expect(await sokha.exam!.backUp()).toBe(1);
  });

  it('one address reports installed apps for a lab\'s worth of computers, not more', async () => {
    const seen: string[] = [];
    const sim = await started({ server: { inventory: async (r) => { seen.push(r.pc); return true; } } });
    const post = (pc: string) => fetch(url(sim, '/inventory'), { method: 'POST', body: JSON.stringify({ v, pc, profiles: [], apps: [] }) });
    const answers: number[] = [];
    for (let i = 0; i < 70; i++) answers.push((await post(`PC-${i}`)).status);
    expect(answers.filter((s) => s === 200)).toHaveLength(60);
    expect(answers.at(-1)).toBe(409);
    // a computer that already reported may again
    expect((await post('PC-3')).status).toBe(200);
  });
});

describe('a classmate can\'t be put out, and work the laptop can\'t keep is said', () => {
  it('a join in the name of a student whose ExamMode is alive is refused, and that student stays in the exam', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    await sim.until(() => sim.view('Dara Kim').connected);
    // (a beat has come over Dara's connection)
    await new Promise((r) => setTimeout(r, sim.clock.ms(2500)));
    const said: unknown[] = [];
    await sim.room.receive({ send: (m) => void said.push(m), close: () => undefined, from: '10.0.0.66' }, { v, type: 'join', runId: sim.room.id, studentId: dara.id, code: sim.code, pc: dara.pc, instanceId: 'someone-else', bootId: 'b' });
    expect(said).toEqual([{ v, type: 'refused', reason: 'nameTaken' }]);
    expect(sim.view('Dara Kim')).toMatchObject({ state: 'inExam', connected: true });
    expect(dara.session!.state).toBe('inExam');
    expect(await kinds(sim)).toContain('nameTaken');
  });

  it('a hand-in lists every file; the ones the laptop has from a backup aren\'t sent again', async () => {
    const sim = await started();
    const dara = sim.student('Dara Kim');
    await dara.write('Report.docx', 'my report');
    await dara.write('code/main.py', 'print(1)');
    expect(await dara.exam!.backUp()).toBe(2);
    const token = dara.session!.token!;
    const files = await Promise.all(['Report.docx', 'code/main.py'].map(async (name) => {
      const path = join(dara.folder, ...name.split('/'));
      return { name, bytes: readFileSync(path).length, sha256: await hashFile(path) };
    }));
    const send = (list: typeof files) => {
      const form = new FormData();
      form.set('meta', JSON.stringify(uploadOf(token, 'handIn', list)));
      return fetch(url(sim, '/upload'), { method: 'POST', body: form });
    };
    // a file that isn't what the laptop has: not a hand-in
    expect((await send([files[0]!, { ...files[1]!, sha256: 'f'.repeat(64) }])).status).toBe(422);
    expect(sim.view('Dara Kim').state).toBe('inExam');
    const res = await send(files);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: 'receipt', files });
    expect(sim.view('Dara Kim')).toMatchObject({ state: 'handedIn', files: 2 });
    expect(readFileSync(join(sim.room.folderOf(dara.id), 'code', 'main.py'), 'utf8')).toBe('print(1)');
  });

  it('files the laptop can\'t keep: the student is told to try again, and the teacher is told why — once', async () => {
    const logged: string[] = [];
    const sim = await started({ server: { log: (where, what) => void logged.push(`${where}: ${what}`) } });
    const dara = sim.student('Dara Kim');
    await dara.write('Report.docx', 'my report');
    // (the student's folder on the laptop can't be made: a file is in its place)
    const { writeFileSync, rmSync } = await import('node:fs');
    rmSync(sim.room.folderOf(dara.id), { recursive: true, force: true });
    writeFileSync(sim.room.folderOf(dara.id), 'in the way');
    expect(await dara.exam!.backUp()).toBe(-1);
    expect(await dara.exam!.backUp()).toBe(-1);
    expect((await kinds(sim)).filter((k) => k === 'uploadFailed')).toHaveLength(1);
    expect(logged).toContain('upload: the files couldn\'t be kept');
    // put right, the next backup is taken
    rmSync(sim.room.folderOf(dara.id));
    expect(await dara.exam!.backUp()).toBe(1);
  });
});
