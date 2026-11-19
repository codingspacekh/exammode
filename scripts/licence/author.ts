/**
 * The author's side of teacher licences (F-44, architecture §2.12): the author's key, and signing a licence for a
 * teacher's request. The private key never leaves the author's computer: it is kept outside the repository, in
 * the author's home folder, locked with a passphrase. What is public — the key's public half — goes into
 * `src/domain/trust/author.json`, and so into every ExamMode.
 */
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, scryptSync } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publicOf } from '@infrastructure/crypto/keys';
import { issue } from '@infrastructure/crypto/licence';
import { parseRequest, type Licence, type Request } from '@domain/trust/licence';

const KEY = 'exammode-author-key.json';
/** scrypt, made slow and memory-hungry on purpose (256 MB, about a second): each guess at the passphrase costs that. */
const SCRYPT = { N: 2 ** 18, r: 8, p: 1, maxmem: 512 * 1024 * 1024 };
const locked = (passphrase: string, salt: Buffer): Buffer => scryptSync(passphrase.normalize('NFKC'), salt, 32, SCRYPT);
const BOOK = 'exammode-licences.jsonl';
export const MIN_PASSPHRASE = 12;

export interface Issued { id: string; at: number; name: string; school: string; email: string; check: string; key: string }

/** Makes the author's key in `home`, locked with the passphrase. Answers with its public half. Never replaces a
 *  key that is there: every licence signed with it would stop working. */
export async function init(home: string, passphrase: string): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`The passphrase needs at least ${MIN_PASSPHRASE} characters.`);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync('ed25519');
  const plain = privateKey.export({ type: 'pkcs8', format: 'der' });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', locked(passphrase, salt), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const file = { v: 1, kdf: 'scrypt', ...SCRYPT, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  // (`wx`: fails if the file is there)
  await writeFile(join(home, KEY), `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'EEXIST' ? new Error(`There is already an author key in ${home}. It is not replaced.`) : error;
  });
  return publicOf(plain.toString('base64'));
}

/** The author's private key, opened with the passphrase. */
async function open(home: string, passphrase: string): Promise<string> {
  const text = await readFile(join(home, KEY), 'utf8').catch(() => {
    throw new Error(`There is no author key in ${home}. Make one first: npm run licence -- init`);
  });
  try {
    const file = JSON.parse(text) as { N: number; r: number; p: number; salt: string; iv: string; tag: string; data: string };
    const key = scryptSync(passphrase.normalize('NFKC'), Buffer.from(file.salt, 'base64'), 32, { N: file.N, r: file.r, p: file.p, maxmem: SCRYPT.maxmem });
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('base64');
  } catch {
    throw new Error('That isn\'t the passphrase of the author key.');
  }
}

/** The public half of the author's key in `home`. */
export async function publicKey(home: string, passphrase: string): Promise<string> {
  return publicOf(await open(home, passphrase));
}

/** Every licence given, oldest first. */
export async function issued(home: string): Promise<Issued[]> {
  const text = await readFile(join(home, BOOK), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Issued);
}

/** The request in an email's text, as the author will be asked about it. */
export function read(text: string): Request {
  const request = parseRequest(text);
  if (!request) throw new Error('There is no whole teacher request in that text: it starts with "ExamMode teacher request" and has Name, School, Email, Check and Key.');
  return request;
}

/** Signs a licence for the request and writes it down in the author's book. The author has checked who this is
 *  before calling it. */
export async function give(home: string, passphrase: string, request: Request, at: number): Promise<{ licence: Licence; again: Issued[] }> {
  const authorKey = await open(home, passphrase);
  const before = await issued(home);
  const id = String(before.length + 1).padStart(4, '0');
  const licence = issue(request, id, at, authorKey);
  const entry: Issued = { id, at, name: request.name, school: request.school, email: request.email, check: request.check, key: request.key };
  await appendFile(join(home, BOOK), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  // licences given before to this key or this address: the author may want to know
  return { licence, again: before.filter((b) => b.key === request.key || b.email.toLowerCase() === request.email.toLowerCase()) };
}

/** A file name for a teacher's licence: `Srey Leak.emlicence`. */
export const fileName = (name: string): string => `${name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'teacher'}.emlicence`;
