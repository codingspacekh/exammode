import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { newKeyPair } from '../../src/trust/keys';
import { checkLicence } from '../../src/trust/licence';
import { requestText } from '@lib/trust/licence';
import { fileName, give, init, issued, publicKey, read } from '../../scripts/licence/author';
import { tempFolder } from './helpers';

const PASS = 'a long passphrase';
/** (as `npm run licence` runs it; `npx` itself can't be started this way on Windows) */
const TSX = join('node_modules', 'tsx', 'dist', 'cli.mjs');
const teacher = newKeyPair();
const REQUEST = { name: 'Srey Leak', school: 'Riverside High School', email: 'sreyleak@riverside-high.example', check: 'riverside-high.example/staff', key: teacher.publicKey };

describe('F-44 the author\'s tool: npm run licence', () => {
  it('init makes the author\'s key once, locked with the passphrase, readable only by the author', async () => {
    const home = join(await tempFolder(), 'author');
    const key = await init(home, PASS);
    expect(await publicKey(home, PASS)).toBe(key);
    const file = join(home, 'exammode-author-key.pem');
    expect(await readFile(file, 'utf8')).toMatch(/^-----BEGIN ENCRYPTED PRIVATE KEY-----/);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o077).toBe(0);
    await expect(publicKey(home, 'not the passphrase')).rejects.toThrow(/isn't the passphrase/);
    // a key that is there is never replaced
    await expect(init(home, PASS)).rejects.toThrow(/already an author key/);
    expect(await publicKey(home, PASS)).toBe(key);
  });

  it('a short passphrase is refused; with no key, it says how to make one', async () => {
    const home = join(await tempFolder(), 'author');
    await expect(init(home, 'short')).rejects.toThrow(/at least 12/);
    await expect(give(home, PASS, REQUEST, 1)).rejects.toThrow(/npm run licence -- init/);
  });

  it('a request becomes a licence ExamMode believes, numbered and written in the author\'s book', async () => {
    const home = join(await tempFolder(), 'author');
    const author = await init(home, PASS);
    const first = await give(home, PASS, read(`Dear author,\n${requestText(REQUEST, 'ExamMode 0.1.0')}`), 1_794_000_000_000);
    expect(first.licence).toMatchObject({ id: '0001', name: 'Srey Leak', key: teacher.publicKey });
    expect(first.again).toEqual([]);
    expect(checkLicence(first.licence, { authorKeys: [author] }, teacher.publicKey).ok).toBe(true);
    // asked again from a new computer: the author is told there was one before
    const second = await give(home, PASS, { ...REQUEST, key: newKeyPair().publicKey }, 1_794_000_100_000);
    expect(second.licence.id).toBe('0002');
    expect(second.again.map((b) => b.id)).toEqual(['0001']);
    expect((await issued(home)).map((l) => `${l.id} ${l.name} ${l.email}`)).toEqual(['0001 Srey Leak sreyleak@riverside-high.example', '0002 Srey Leak sreyleak@riverside-high.example']);
    await expect(give(home, 'not the passphrase', REQUEST, 1)).rejects.toThrow(/passphrase/);
    expect(await issued(home)).toHaveLength(2);
  });

  it('a text with no whole request says what one looks like; a licence file is named after the teacher', () => {
    expect(() => read('Hello, may I be a teacher?')).toThrow(/ExamMode teacher request/);
    expect(fileName('Srey Leak')).toBe('Srey Leak.emlicence');
    expect(fileName('../../etc/x')).toBe('....etcx.emlicence');
    expect(fileName('/')).toBe('teacher.emlicence');
  });

  it('as a command: a request file in, a licence file out', async () => {
    const root = await tempFolder();
    const home = join(root, 'author');
    const author = await init(home, PASS);
    await writeFile(join(root, 'request.txt'), requestText(REQUEST));
    const { stdout } = await promisify(execFile)(process.execPath, [TSX, 'scripts/licence/cli.ts', join(root, 'request.txt'), '--home', home, '--out', root, '--yes'], { env: { ...process.env, EXAMMODE_AUTHOR_PASSPHRASE: PASS } });
    expect(stdout).toMatch(/Licence 0001 for Srey Leak/);
    const licence = JSON.parse(await readFile(join(root, 'Srey Leak.emlicence'), 'utf8')) as unknown;
    expect(checkLicence(licence, { authorKeys: [author] }, teacher.publicKey).ok).toBe(true);
    const list = await promisify(execFile)(process.execPath, [TSX, 'scripts/licence/cli.ts', 'list', '--home', home]);
    expect(list.stdout).toMatch(/0001 .*Srey Leak · Riverside High School/);
  }, 60_000);
});
