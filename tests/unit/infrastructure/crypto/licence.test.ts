import { describe, expect, it } from 'vitest';
import { newKeyPair } from '@infrastructure/crypto/keys';
import { checkLicence, issue } from '@infrastructure/crypto/licence';
import { parseRequest, requestText, type Request } from '@domain/trust/licence';

const author = newKeyPair();
const teacher = newKeyPair();
const REQUEST: Request = { name: 'Srey Leak', school: 'Riverside High School', email: 'sreyleak@riverside-high.example', check: 'riverside-high.example/staff', note: 'Year 10 ICT', key: teacher.publicKey };
const trust = { authorKeys: [author.publicKey] };

describe('F-44 the request a teacher sends', () => {
  it('is text for an email: who they are, where to check, the public half of their key', () => {
    expect(requestText(REQUEST, 'ExamMode 0.1.0 · macOS')).toBe([
      'ExamMode teacher request', 'Name: Srey Leak', 'School: Riverside High School', 'Email: sreyleak@riverside-high.example',
      'Check: riverside-high.example/staff', 'Note: Year 10 ICT', `Key: ${teacher.publicKey}`, 'ExamMode 0.1.0 · macOS',
    ].join('\n'));
  });
  it('a note is left out when there is none, and stays on one line', () => {
    expect(requestText({ ...REQUEST, note: undefined })).not.toContain('Note:');
    expect(requestText({ ...REQUEST, note: 'two\nlines' })).toContain('Note: two lines');
  });
  it('is read back from the email, with a greeting around it or quoted in a reply', () => {
    const plain: Request = { ...REQUEST, note: undefined };
    expect(parseRequest(`Hello,\n\n${requestText(REQUEST, 'ExamMode 0.1.0')}\n\nThank you`)).toEqual(REQUEST);
    expect(parseRequest(requestText(plain).split('\n').map((l) => `> ${l}`).join('\r\n'))).toEqual({ ...plain, note: undefined });
  });
  it('a text with no request, or one that isn\'t whole, is nothing', () => {
    expect(parseRequest('Hello, may I have a licence?')).toBeUndefined();
    expect(parseRequest(requestText(REQUEST).replace(/^Key: .*$/m, 'Key: short'))).toBeUndefined();
    expect(parseRequest(requestText(REQUEST).replace(/^Email: .*$/m, 'Email: not an address'))).toBeUndefined();
  });
  it('a field said twice counts once: the first', () => {
    expect(parseRequest(`${requestText(REQUEST)}\nName: Someone Else`)?.name).toBe('Srey Leak');
  });
});

describe('F-44 the teacher licence', () => {
  const licence = issue(REQUEST, '0042', 1_794_000_000_000, author.privateKey);
  it('says who the teacher is and which key is theirs, signed by the author', () => {
    expect(licence).toMatchObject({ v: 1, app: 'exammode', id: '0042', name: 'Srey Leak', school: 'Riverside High School', key: teacher.publicKey, issuedAt: 1_794_000_000_000 });
    expect(checkLicence(licence, trust)).toEqual({ ok: true, licence });
    // as it comes out of a file
    expect(checkLicence(JSON.parse(JSON.stringify(licence)), trust, teacher.publicKey).ok).toBe(true);
  });
  it('F-44 a licence for another computer\'s key is refused', () => {
    expect(checkLicence(licence, trust, newKeyPair().publicKey)).toEqual({ ok: false, why: 'otherComputer' });
  });
  it('a licence that was changed, or signed by someone else, is not from the author', () => {
    expect(checkLicence({ ...licence, name: 'Someone Else' }, trust)).toEqual({ ok: false, why: 'notFromAuthor' });
    expect(checkLicence({ ...licence, key: newKeyPair().publicKey }, trust)).toEqual({ ok: false, why: 'notFromAuthor' });
    expect(checkLicence(issue(REQUEST, '0001', 1, newKeyPair().privateKey), trust)).toEqual({ ok: false, why: 'notFromAuthor' });
    expect(checkLicence(licence, { authorKeys: [] })).toEqual({ ok: false, why: 'notFromAuthor' });
  });
  it('a second author key is believed too (a new key, while the old licences still work)', () => {
    expect(checkLicence(licence, { authorKeys: [newKeyPair().publicKey, author.publicKey] }).ok).toBe(true);
  });
  it('a licence the author took back is refused', () => {
    expect(checkLicence(licence, { ...trust, withdrawn: ['0042'] })).toEqual({ ok: false, why: 'withdrawn' });
    expect(checkLicence(licence, { ...trust, withdrawn: ['0041'] }).ok).toBe(true);
  });
  it('something that isn\'t a licence is invalid', () => {
    expect(checkLicence(undefined, trust)).toEqual({ ok: false, why: 'invalid' });
    expect(checkLicence({ ...licence, app: 'microlab' }, trust)).toEqual({ ok: false, why: 'invalid' });
    expect(checkLicence({ ...licence, sig: undefined }, trust)).toEqual({ ok: false, why: 'invalid' });
  });
});
