import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION, beacon, parseFromStudent, parseFromTeacher, stopped, updateReply, upload,
} from '@lib/protocol/messages';

const v = PROTOCOL_VERSION;
const sha = 'a'.repeat(64);
const join = { v, type: 'join', runId: 'r-1', studentId: 's-07', code: '4821', pc: 'PC-07', instanceId: 'i-1', bootId: 'b-1' };

/** The classroom protocol of architecture §2.7: one definition, checked at both ends. */
describe('§2.7 messages from a student', () => {
  it.each([
    join,
    { v, type: 'resume', token: 't-1', instanceId: 'i-1', localLog: [{ at: 1, kind: 'appClosed', details: { app: 'Notepad' } }] },
    { v, type: 'checks', results: [{ check: 'oneScreen', ok: true }] },
    { v, type: 'ready' },
    { v, type: 'beat', seq: 12, front: 'Word' },
    { v, type: 'beat', seq: 13 },
    { v, type: 'event', kind: 'pageBlocked', details: { url: 'https://chatgpt.com/' } },
    { v, type: 'leave' },
  ])('$type is accepted', (msg) => {
    expect(parseFromStudent(msg)).toEqual({ ok: true, msg });
  });
  it('F-03 the code is 4 digits', () => {
    expect(parseFromStudent({ ...join, code: '482' })).toEqual({ ok: false, reason: 'invalid' });
    expect(parseFromStudent({ ...join, code: 'abcd' })).toEqual({ ok: false, reason: 'invalid' });
  });
  it('a message with a part missing, an unknown type, or that is not an object is invalid', () => {
    const noPc = { ...join, pc: undefined };
    for (const bad of [noPc, { v, type: 'dance' }, { v }, 'join', null, 7, { type: 'ready' }, { v: '1', type: 'ready' }, { v: 1.5, type: 'ready' }]) {
      expect(parseFromStudent(bad)).toEqual({ ok: false, reason: 'invalid' });
    }
  });
  it('parts a newer client adds are dropped, not refused', () => {
    expect(parseFromStudent({ v, type: 'ready', mood: 'calm' })).toEqual({ ok: true, msg: { v, type: 'ready' } });
  });
  it("a message from the teacher's side is not one from a student", () => {
    expect(parseFromStudent({ v, type: 'end' })).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('§2.7 versions', () => {
  it('an old client is told to update, whatever it sent', () => {
    expect(parseFromStudent({ ...join, v: v - 1 })).toEqual({ ok: false, reason: 'older' });
    expect(parseFromStudent({ v: 0, type: 'something old' })).toEqual({ ok: false, reason: 'older' });
    expect(updateReply()).toEqual({ v, type: 'refused', reason: 'update' });
    expect(parseFromTeacher(updateReply()).ok).toBe(true);
  });
  it('a newer sender is told apart from an invalid message', () => {
    expect(parseFromStudent({ ...join, v: v + 1 })).toEqual({ ok: false, reason: 'newer' });
    expect(parseFromTeacher({ v: v + 1, type: 'end' })).toEqual({ ok: false, reason: 'newer' });
  });
});

describe('§2.7 messages from the teacher', () => {
  it.each([
    { v, type: 'joined', token: 't-1', now: 1_800_000_000_000, state: 'checking' },
    { v, type: 'joined', token: 't-1', now: 1_800_000_000_000, state: 'inExam', endsAt: 1_800_003_600_000 },
    { v, type: 'refused', reason: 'codeWrong' },
    { v, type: 'refused', reason: 'nameTaken' },
    { v, type: 'refused', reason: 'left' },
    { v, type: 'start', endsAt: 1_800_003_600_000 },
    { v, type: 'time', endsAt: 1_800_004_200_000 },
    { v, type: 'end' },
    { v, type: 'unlock' },
    { v, type: 'receipt', code: 'HX7-29Q', files: [{ name: 'Report.docx', bytes: 18_220, sha256: sha }] },
  ])('$type is accepted', (msg) => {
    expect(parseFromTeacher(msg)).toEqual({ ok: true, msg });
  });
  it('an unknown reason or a badly shaped receipt code is invalid', () => {
    expect(parseFromTeacher({ v, type: 'refused', reason: 'because' })).toEqual({ ok: false, reason: 'invalid' });
    expect(parseFromTeacher({ v, type: 'receipt', code: 'hx729q', files: [] })).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('§2.7 the beacon, the Guard and files', () => {
  it('F-01 the beacon says which run is open, and where', () => {
    const b = { v, runId: 'r-1', title: 'Year 10 ICT — Term 1 practical exam', teacher: 'Ms Leak', class: '10A', port: 47800, teacherKeyFp: null };
    expect(beacon.parse(b)).toEqual(b);
    expect(beacon.safeParse({ ...b, port: 70_000 }).success).toBe(false);
  });
  it("F-20 the Guard's stopped carries the attempt's token", () => {
    const s = { v, type: 'stopped', token: 't-1', pc: 'PC-07', instanceId: 'i-1', at: 1_800_000_000_000 };
    expect(stopped.parse(s)).toEqual(s);
    expect(stopped.safeParse({ ...s, token: '' }).success).toBe(false);
  });
  it('F-16 F-22 a hand-in or a backup lists its files with their SHA-256', () => {
    const u = { v, token: 't-1', kind: 'handIn', files: [{ name: 'Report.docx', bytes: 18_220, sha256: sha }] };
    expect(upload.parse(u)).toEqual(u);
    expect(upload.safeParse({ ...u, kind: 'backup' }).success).toBe(true);
    expect(upload.safeParse({ ...u, files: [{ name: 'Report.docx', bytes: 18_220, sha256: 'ABC' }] }).success).toBe(false);
    expect(upload.safeParse({ ...u, files: [{ name: '', bytes: 1, sha256: sha }] }).success).toBe(false);
  });
});
