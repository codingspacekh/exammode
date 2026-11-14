/**
 * The author's side of teacher licences (F-44, architecture §2.12): the author's key, and signing a licence for a
 * teacher's request. The private key never leaves the author's computer: it is kept outside the repository, in
 * the author's home folder, locked with a passphrase. What is public — the key's public half — goes into
 * `src/lib/trust/author.json`, and so into every ExamMode.
 */
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publicOf } from '../../src/trust/keys';
import { issue } from '../../src/trust/licence';
import { parseRequest, type Licence, type Request } from '@lib/trust/licence';

const KEY = 'exammode-author-key.pem';
const BOOK = 'exammode-licences.jsonl';
export const MIN_PASSPHRASE = 12;

export interface Issued { id: string; at: number; name: string; school: string; email: string; check: string; key: string }

/** Makes the author's key in `home`, locked with the passphrase. Answers with its public half. Never replaces a
 *  key that is there: every licence signed with it would stop working. */
export async function init(home: string, passphrase: string): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`The passphrase needs at least ${MIN_PASSPHRASE} characters.`);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase });
  // (`wx`: fails if the file is there)
  await writeFile(join(home, KEY), pem, { mode: 0o600, flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'EEXIST' ? new Error(`There is already an author key in ${home}. It is not replaced.`) : error;
  });
  return publicOf(privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'));
}

/** The author's private key, opened with the passphrase. */
async function open(home: string, passphrase: string): Promise<string> {
  const pem = await readFile(join(home, KEY), 'utf8').catch(() => {
    throw new Error(`There is no author key in ${home}. Make one first: npm run licence -- init`);
  });
  try {
    return createPrivateKey({ key: pem, format: 'pem', passphrase }).export({ type: 'pkcs8', format: 'der' }).toString('base64');
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
