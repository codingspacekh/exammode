import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, beacon, type Beacon } from '@lib/protocol/messages';
import { fingerprint, newKeyPair } from '../../../src/trust/keys';
import { issue } from '../../../src/trust/licence';
import { checkMessage, checkUpload, signBeacon, signMessage, signUpload, teacherOf, type Identity } from '../../../src/trust/signed';

const author = newKeyPair();
const trust = { authorKeys: [author.publicKey] };
const identity = (name = 'Srey Leak', by = author.privateKey): Identity => {
  const keys = newKeyPair();
  return { privateKey: keys.privateKey, licence: issue({ name, school: 'Riverside High School', key: keys.publicKey }, '0042', 1, by) };
};
const teacher = identity();
const EXAM: Beacon = { v: PROTOCOL_VERSION, runId: '3f2a9c41-07be-4d25-8a55-1b2c3d4e5f60', title: 'Term 1', teacher: 'Ms Srey Leak', class: 'Year 10 A', minutes: 90, port: 47800, teacherKeyFp: null };

describe('F-44 the announcement of an exam', () => {
  const signed = signBeacon(EXAM, teacher);
  it('carries the licence and the key\'s fingerprint; as it arrives, it is the licensed teacher\'s', () => {
    expect(signed).toMatchObject({ ...EXAM, teacherKeyFp: fingerprint(teacher.licence.key), licence: teacher.licence });
    const arrived = beacon.parse(JSON.parse(JSON.stringify(signed)));
    expect(teacherOf(arrived, trust)).toBe(teacher.licence.key);
  });
  it('a part a newer teacher\'s laptop added was signed too, and is kept', () => {
    const newer = signBeacon({ ...EXAM, room: 'Lab 2' } as Beacon, teacher);
    expect(teacherOf(beacon.parse(JSON.parse(JSON.stringify(newer))), trust)).toBe(teacher.licence.key);
  });
  it('F-44 a beacon signed by an unlicensed key isn\'t listed', () => {
    // a licence someone made for themselves
    expect(teacherOf(signBeacon(EXAM, identity('Fake Teacher', newKeyPair().privateKey)), trust)).toBeUndefined();
    // a real teacher's licence, borrowed by another key
    expect(teacherOf(signBeacon(EXAM, { licence: teacher.licence, privateKey: newKeyPair().privateKey }), trust)).toBeUndefined();
    // a real announcement, changed on the way: another port, another title
    expect(teacherOf({ ...signed, port: 9999 }, trust)).toBeUndefined();
    expect(teacherOf({ ...signed, title: 'Term 1 (copy)' }, trust)).toBeUndefined();
  });
  it('a teacher with no licence is taken only by a development build, and has no key', () => {
    expect(teacherOf(EXAM, trust)).toBeUndefined();
    expect(teacherOf({ ...signed, sig: undefined }, trust)).toBeUndefined();
    expect(teacherOf(EXAM, { ...trust, allowUnsigned: true })).toBeNull();
    // … which still doesn't take a licence that is wrong
    expect(teacherOf({ ...signed, title: 'x' }, { ...trust, allowUnsigned: true })).toBeUndefined();
  });
  it('signing again replaces the signature', () => {
    expect(teacherOf(signBeacon({ ...signed, title: 'Term 2' }, teacher), trust)).toBe(teacher.licence.key);
  });
});

describe('F-44 a message to a student', () => {
  const key = teacher.licence.key;
  const start = { v: PROTOCOL_VERSION, type: 'start', endsAt: 5000 };
  const signed = JSON.parse(JSON.stringify(signMessage(start, 'nonce-of-this-join', 3, teacher.privateKey))) as Record<string, unknown>;
  it('is the pinned teacher\'s, for this connection, and counted', () => {
    expect(signed).toMatchObject({ ...start, n: 3 });
    expect(checkMessage(signed, 'nonce-of-this-join', 2, key)).toBe(3);
    expect(checkMessage(signed, 'nonce-of-this-join', -1, key)).toBe(3);
  });
  it('F-44 after joining, a message signed by another teacher\'s key is ignored', () => {
    const other = identity('Another Teacher');
    expect(checkMessage(signMessage(start, 'nonce-of-this-join', 3, other.privateKey), 'nonce-of-this-join', 2, key)).toBeUndefined();
  });
  it('one that was changed, played again, or made for another connection is ignored', () => {
    expect(checkMessage({ ...signed, endsAt: 9000 }, 'nonce-of-this-join', 2, key)).toBeUndefined();
    expect(checkMessage(signed, 'nonce-of-this-join', 3, key)).toBeUndefined();
    expect(checkMessage(signed, 'another-join', 2, key)).toBeUndefined();
    expect(checkMessage({ ...signed, n: 4 }, 'nonce-of-this-join', 2, key)).toBeUndefined();
  });
  it('one with no signature or no count, or that isn\'t a message, is ignored', () => {
    expect(checkMessage(start, 'nonce-of-this-join', -1, key)).toBeUndefined();
    expect(checkMessage({ ...signed, n: '3' }, 'nonce-of-this-join', -1, key)).toBeUndefined();
    expect(checkMessage({ ...signed, n: 3.5 }, 'nonce-of-this-join', -1, key)).toBeUndefined();
    expect(checkMessage(null, 'nonce-of-this-join', -1, key)).toBeUndefined();
    expect(checkMessage('start', 'nonce-of-this-join', -1, key)).toBeUndefined();
  });
});

describe('F-44 the answer to a backup or a hand-in', () => {
  const files = [{ name: 'Report.docx', bytes: 20, sha256: 'a'.repeat(64) }];
  const sig = signUpload('token-1', 'handIn', files, teacher.privateKey);
  it('says the teacher\'s laptop has exactly these files of this student', () => {
    expect(checkUpload(sig, 'token-1', 'handIn', files, teacher.licence.key)).toBe(true);
  });
  it('not other files, another student, a backup shown as a hand-in, another laptop, or no signature', () => {
    expect(checkUpload(sig, 'token-1', 'handIn', [{ ...files[0]!, sha256: 'b'.repeat(64) }], teacher.licence.key)).toBe(false);
    expect(checkUpload(sig, 'token-2', 'handIn', files, teacher.licence.key)).toBe(false);
    expect(checkUpload(sig, 'token-1', 'backup', files, teacher.licence.key)).toBe(false);
    expect(checkUpload(sig, 'token-1', 'handIn', files, identity().licence.key)).toBe(false);
    expect(checkUpload(undefined, 'token-1', 'handIn', files, teacher.licence.key)).toBe(false);
  });
});
