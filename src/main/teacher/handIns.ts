/**
 * Files arriving on the teacher's laptop (architecture §2.9, F-16, F-22). A file is first written next to the
 * hand-ins while its SHA-256 is worked out, and only moved into the student's folder once it is the file that was
 * announced: a half-sent file never replaces a good copy (N-05).
 */
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** A file as it arrived: where it was put, and what it really is. */
export interface Received { name: string; bytes: number; sha256: string; path: string }

/** Where files wait until they are checked. Inside Hand-ins, so moving them into place never copies. */
export const incomingFolder = (handIns: string): string => join(handIns, '.incoming');

/** A folder for one upload's files. */
export async function newIncoming(handIns: string): Promise<string> {
  const folder = join(incomingFolder(handIns), randomUUID());
  await mkdir(folder, { recursive: true });
  return folder;
}

/** Writes what arrives to a file of its own in `folder`, hashing it on the way. */
export async function receive(name: string, from: Readable, folder: string): Promise<Received> {
  const path = join(folder, randomUUID());
  const hash = createHash('sha256');
  let bytes = 0;
  from.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
  });
  await pipeline(from, createWriteStream(path));
  return { name, bytes, sha256: hash.digest('hex'), path };
}

/** Moves a checked file to `folder/name`, taking the place of an older copy. */
export async function place(file: { path: string }, folder: string, name: string): Promise<void> {
  const to = join(folder, ...name.split('/'));
  await mkdir(dirname(to), { recursive: true });
  await rename(file.path, to);
}

/** Moves `folder/name` to `folder/aside/name`: kept, but out of the way. A file that is gone is left alone. */
export async function setAside(folder: string, name: string, aside: string): Promise<void> {
  const to = join(folder, aside, ...name.split('/'));
  await mkdir(dirname(to), { recursive: true });
  await rename(join(folder, ...name.split('/')), to).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export const discard = (folder: string): Promise<void> => rm(folder, { recursive: true, force: true });
