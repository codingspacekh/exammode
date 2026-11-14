/**
 * The Exam folder on a lab computer (architecture §2.9): what is in it, what changed since the last backup (F-22),
 * what goes in the hand-in (F-16), and sending files to the teacher's laptop. Which files changed and which are
 * handed in is decided by src/lib/files; this reads the disk and talks to the network.
 */
import { createHash } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { changed, nextSnapshot, toHash, type FileStat, type HashedFile, type Snapshot } from '@lib/files/changes';
import { handInList } from '@lib/files/handIn';
import { isSafeName, isWorkFile } from '@lib/files/names';
import { PROTOCOL_VERSION, type FileMeta, type Upload } from '@lib/protocol/messages';

const pathOf = (folder: string, name: string): string => join(folder, ...name.split('/'));

/** Every file of the student's work in the folder and the folders inside it, by its name from the Exam folder. */
export async function listFiles(folder: string): Promise<FileStat[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  const files: FileStat[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const name = relative(folder, path).replaceAll('\\', '/');
    if (!isWorkFile(name) || !isSafeName(name)) continue;
    // a file can go between being listed and being looked at
    const info = await stat(path).catch(() => undefined);
    if (info) files.push({ name, bytes: info.size, modified: Math.round(info.mtimeMs) });
  }
  return files.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

const meta = ({ name, bytes, sha256 }: HashedFile): FileMeta => ({ name, bytes, sha256 });

export type Sent = { ok: true; body: unknown } | { ok: false; status: number };

/** Sends files to the teacher's laptop: who and what first, then each file (the server's POST /upload). */
export async function sendFiles(base: string, upload: Upload, folder: string, send: typeof fetch = fetch): Promise<Sent> {
  const form = new FormData();
  form.set('meta', JSON.stringify(upload));
  for (const [i, file] of upload.files.entries()) form.set(`f${i}`, await openAsBlob(pathOf(folder, file.name)), 'file');
  const res = await send(`${base}/upload`, { method: 'POST', body: form });
  return res.ok ? { ok: true, body: await res.json() } : { ok: false, status: res.status };
}

export class ExamFiles {
  /** what the teacher's laptop has: the files as they were at the last backup */
  private snapshot: Snapshot = {};

  /** the files the teacher gave, as they were given */
  private given: FileMeta[] = [];
  /** given files that were fetched once: one the student deleted isn't fetched again */
  private readonly fetched = new Set<string>();

  constructor(readonly folder: string) {}

  /** Makes the Exam folder. Files that are in it already (the student was let back in) count as not backed up. */
  async begin(): Promise<void> {
    await mkdir(this.folder, { recursive: true });
  }

  /** Puts the teacher's files in the Exam folder (F-33): each is fetched once, checked by its SHA-256, and never
   *  written over a file that is already there — a student who was let back in keeps their own copy. A given
   *  file left as it was isn't backed up or handed in. Answers how many are still to fetch. */
  async give(files: FileMeta[], fetchOne: (name: string) => Promise<Response>): Promise<number> {
    this.given = files;
    for (const f of files) this.snapshot[f.name] ??= { name: f.name, bytes: -1, modified: -1, sha256: f.sha256 };
    for (const f of files) {
      if (this.fetched.has(f.name) || !isSafeName(f.name) || f.name.includes('/')) continue;
      const to = pathOf(this.folder, f.name);
      if (await stat(to).then(() => true, () => false)) {
        this.fetched.add(f.name);
        continue;
      }
      try {
        const res = await fetchOne(f.name);
        if (!res.ok) continue;
        const data = Buffer.from(await res.arrayBuffer());
        if (createHash('sha256').update(data).digest('hex') !== f.sha256) continue;
        await writeFile(to, data, { flag: 'wx' });
        this.fetched.add(f.name);
      } catch {
        // no contact now: it is tried again with the next backup
      }
    }
    return files.filter((f) => !this.fetched.has(f.name)).length;
  }

  /** The Exam folder as Hand in shows it (09): what the student made or changed, and what was given and left
   *  alone. */
  async view(): Promise<{ files: FileStat[]; unchanged: FileStat[] }> {
    const list = handInList(this.given, await this.hashed(await listFiles(this.folder)));
    const plain = ({ name, bytes, modified }: HashedFile): FileStat => ({ name, bytes, modified });
    return { files: list.send.map(plain), unchanged: list.unchanged.map(plain) };
  }

  private async hashed(files: FileStat[]): Promise<HashedFile[]> {
    const done: HashedFile[] = [];
    for (const f of files) {
      const sha256 = await hashFile(pathOf(this.folder, f.name)).catch(() => undefined);
      if (sha256) done.push({ ...f, sha256 });
    }
    return done;
  }

  /** The files to back up now, and `sent` to call once the teacher has them. */
  async toBackUp(): Promise<{ files: FileMeta[]; sent: () => void }> {
    const now = await listFiles(this.folder);
    const hashed = await this.hashed(toHash(this.snapshot, now));
    const next = nextSnapshot(this.snapshot, now, hashed);
    return { files: changed(this.snapshot, hashed).map(meta), sent: () => void (this.snapshot = next) };
  }

  /** The hand-in: everything the student made or changed (F-16). */
  async toHandIn(): Promise<FileMeta[]> {
    return handInList(this.given, await this.hashed(await listFiles(this.folder))).send.map(meta);
  }

  /** Once the teacher has the work (F-21). */
  remove(): Promise<void> {
    return rm(this.folder, { recursive: true, force: true, maxRetries: 5 });
  }
}

export const uploadOf = (token: string, kind: Upload['kind'], files: FileMeta[]): Upload => ({ v: PROTOCOL_VERSION, token, kind, files });
