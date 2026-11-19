/**
 * File and folder names (F-16, F-22, F-42). A file's name comes from a lab computer and is written to the teacher's
 * disk, so it is checked first: always inside the student's own folder, and storable on Windows and macOS alike.
 * Names are relative to the Exam folder, with `/` between folders.
 */

const FORBIDDEN = /[<>:"|?*\\\p{Cc}]/u;
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const MAX = 240;

const safePart = (part: string): boolean =>
  part !== '' && part !== '.' && part !== '..' && !FORBIDDEN.test(part) && !DEVICE.test(part) && !/[. ]$/.test(part);

export function isSafeName(name: string): boolean {
  return name.length <= MAX && name.split('/').every(safePart);
}

const JUNK = [/^~\$/, /^\.~lock\./, /^thumbs\.db$/i, /^desktop\.ini$/i, /^\.DS_Store$/, /\.part$/i, /^~.*\.tmp$/i];

/** Not an app's lock file or one of the system's own: worth backing up and handing in. */
export function isWorkFile(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1);
  return !JUNK.some((junk) => junk.test(base));
}

/** A title as a folder name: nothing a file system refuses, at most 80 characters. */
export function folderName(title: string): string {
  const clean = title.replace(/[<>:"|?*\\/\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80).trim();
  if (clean === '' || /^\.+$/.test(clean)) return 'Exam';
  return DEVICE.test(clean) ? `${clean}_` : clean;
}

export interface Named { id: string; name: string; email?: string | null }

/** Each student's folder in a run's hand-ins: their name; with their email (or id) when the name is shared (F-02). */
export function studentFolders(students: Named[]): Map<string, string> {
  const key = (s: Named) => folderName(s.name).toLowerCase();
  const count = new Map<string, number>();
  for (const s of students) count.set(key(s), (count.get(key(s)) ?? 0) + 1);
  return new Map(students.map((s) => {
    const shared = (count.get(key(s)) ?? 0) > 1;
    return [s.id, shared ? folderName(`${s.name} (${s.email ?? s.id})`) : folderName(s.name)];
  }));
}
