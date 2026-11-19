/** The hand-in list of screen 09 (F-16): what the student made, what they changed, and what was given and left alone. */

export interface NamedHash { name: string; sha256: string }

export interface HandInList<T> {
  made: T[];
  changed: T[];
  /** given by the teacher and not changed: listed, not sent */
  unchanged: T[];
  /** what goes to the teacher: made and changed, by name */
  send: T[];
}

export function handInList<T extends NamedHash>(given: NamedHash[], now: T[]): HandInList<T> {
  const original = new Map(given.map((f) => [f.name, f.sha256]));
  const made = now.filter((f) => !original.has(f.name));
  const changed = now.filter((f) => original.has(f.name) && original.get(f.name) !== f.sha256);
  const unchanged = now.filter((f) => original.get(f.name) === f.sha256);
  const send = [...made, ...changed].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return { made, changed, unchanged, send };
}
