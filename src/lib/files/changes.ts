/**
 * Which files in the Exam folder changed since the last backup (F-22, architecture §2.9): by size and modified
 * time first, which costs nothing, and only then by SHA-256. Pure: the caller lists the folder and hashes.
 */

export interface FileStat { name: string; bytes: number; modified: number }
export interface HashedFile extends FileStat { sha256: string }
/** What was known at the last backup, by file name. */
export type Snapshot = Record<string, HashedFile>;

/** The files worth reading: new ones, and ones whose size or time changed. */
export function toHash(last: Snapshot, now: FileStat[]): FileStat[] {
  return now.filter((f) => last[f.name]?.bytes !== f.bytes || last[f.name]?.modified !== f.modified);
}

/** Of the files just hashed, the ones to send: new, or with different content. */
export function changed(last: Snapshot, hashed: HashedFile[]): HashedFile[] {
  return hashed.filter((f) => last[f.name]?.sha256 !== f.sha256);
}

/** The snapshot for next time: what was just hashed, what didn't need it, and nothing that is gone. */
export function nextSnapshot(last: Snapshot, now: FileStat[], hashed: HashedFile[]): Snapshot {
  const fresh = new Map(hashed.map((f) => [f.name, f]));
  const next: Snapshot = {};
  for (const { name } of now) {
    const known = fresh.get(name) ?? last[name];
    if (known) next[name] = known;
  }
  return next;
}
