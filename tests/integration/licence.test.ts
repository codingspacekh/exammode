import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newKeyPair } from '../../src/trust/keys';
import { issue } from '../../src/trust/licence';
import { parseRequest } from '@lib/trust/licence';
import { TeacherLicence, licenceLine, type Vault } from '../../src/main/teacher/licence';
import { tempFolder } from './helpers';

const author = newKeyPair();
const trust = { authorKeys: [author.publicKey] };
const FORM = { name: 'Srey Leak', school: 'Riverside High School', email: 'sreyleak@riverside-high.example', check: 'riverside-high.example/staff', note: ' ' };
/** A vault that only this "computer" can open. */
const vault = (secret: string): Vault => ({
  seal: (text) => `${secret}:${text}`,
  open: (sealed) => {
    if (!sealed.startsWith(`${secret}:`)) throw new Error('another computer');
    return sealed.slice(secret.length + 1);
  },
});

describe('F-44 a teacher asks for a licence, and loads it', () => {
  async function teacher() {
    const folder = join(await tempFolder(), 'settings');
    return { folder, laptop: new TeacherLicence(folder, trust, vault('this-mac')) };
  }
  /** what the author does with the email: `npm run licence` */
  const answer = async (text: string, folder: string, by = author.privateKey) => {
    const file = join(folder, 'Srey Leak.emlicence');
    await writeFile(file, JSON.stringify(issue(parseRequest(text)!, '0042', 1_794_000_000_000, by)));
    return file;
  };

  it('the request says who they are and carries the public half of a key made on this laptop; the private half is sealed', async () => {
    const { folder, laptop } = await teacher();
    expect(await laptop.identity()).toBeUndefined();
    const asked = await laptop.request(FORM, 'ExamMode 0.1.0 · macOS');
    const text = (asked as { text: string }).text;
    expect(parseRequest(text)).toMatchObject({ name: 'Srey Leak', school: 'Riverside High School', email: 'sreyleak@riverside-high.example', check: 'riverside-high.example/staff' });
    expect(text).not.toContain('Note:');
    const kept = JSON.parse(await readFile(join(folder, 'teacher-key.json'), 'utf8')) as { publicKey: string; sealed: string };
    expect(kept.publicKey).toBe(parseRequest(text)!.key);
    expect(kept.sealed.startsWith('this-mac:')).toBe(true);
    // asking again is the same key: a licence on its way still fits
    expect(parseRequest(((await laptop.request({ ...FORM, note: 'Year 10 ICT' }, '')) as { text: string }).text)!.key).toBe(kept.publicKey);
  });

  it('what is missing is said in words, and no key is made for it', async () => {
    const { folder, laptop } = await teacher();
    expect(await laptop.request({ ...FORM, name: ' ' }, '')).toEqual({ error: 'Type your name.' });
    expect(await laptop.request({ ...FORM, email: 'sreyleak' }, '')).toEqual({ error: 'Type your school email address.' });
    expect(await laptop.request({ ...FORM, check: '' }, '')).toMatchObject({ error: expect.stringMatching(/staff page/) });
    await expect(readFile(join(folder, 'teacher-key.json'))).rejects.toThrow();
  });

  it('the author\'s licence for this laptop\'s key makes it a teacher\'s — and still after ExamMode starts again', async () => {
    const { folder, laptop } = await teacher();
    const { text } = (await laptop.request(FORM, '')) as { text: string };
    const loaded = await laptop.load(await answer(text, folder));
    expect(loaded).toMatchObject({ ok: true, licence: { name: 'Srey Leak', id: '0042' } });
    const again = await new TeacherLicence(folder, trust, vault('this-mac')).identity();
    expect(again?.licence.key).toBe(parseRequest(text)!.key);
    expect(licenceLine(again!.licence)).toBe('Srey Leak · Riverside High School · licence 0042');
  });

  it('F-44 a licence for another computer\'s key is refused; so is one the author didn\'t sign, and a file that isn\'t one', async () => {
    const { folder, laptop } = await teacher();
    const { text } = (await laptop.request(FORM, '')) as { text: string };
    const other = await teacher();
    const theirs = (await other.laptop.request(FORM, '')) as { text: string };
    expect(await laptop.load(await answer(theirs.text, folder))).toEqual({ ok: false, why: 'otherComputer' });
    expect(await laptop.load(await answer(text, folder, newKeyPair().privateKey))).toEqual({ ok: false, why: 'notFromAuthor' });
    await writeFile(join(folder, 'notes.txt'), 'hello');
    expect(await laptop.load(join(folder, 'notes.txt'))).toEqual({ ok: false, why: 'unreadable' });
    expect(await laptop.load(join(folder, 'missing.emlicence'))).toEqual({ ok: false, why: 'unreadable' });
    expect(await laptop.identity()).toBeUndefined();
  });

  it('a licence opened on a computer that never asked for one says so', async () => {
    const { laptop } = await teacher();
    const elsewhere = await teacher();
    const { text } = (await elsewhere.laptop.request(FORM, '')) as { text: string };
    expect(await laptop.load(await answer(text, elsewhere.folder))).toEqual({ ok: false, why: 'noRequest' });
  });

  it('the settings folder copied to another computer is no teacher\'s: the key can\'t be opened there', async () => {
    const { folder, laptop } = await teacher();
    const { text } = (await laptop.request(FORM, '')) as { text: string };
    await laptop.load(await answer(text, folder));
    expect(await new TeacherLicence(folder, trust, vault('a-lab-pc')).identity()).toBeUndefined();
    // … nor with a licence the author has taken back
    expect(await new TeacherLicence(folder, { ...trust, withdrawn: ['0042'] }, vault('this-mac')).identity()).toBeUndefined();
  });
});
