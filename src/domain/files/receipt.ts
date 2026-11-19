/**
 * The receipt of a hand-in (F-16, architecture §2.9): 6 characters from the SHA-256 of the run, the student and the
 * files' names and hashes, shown as `HX7-29Q`. Both sides work it out, so the student's matches the teacher's list.
 */
import type { NamedHash } from './handIn';

/** No 0, O, 1, I or L: nothing a student could misread. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export async function receiptCode(runId: string, studentId: string, files: NamedHash[]): Promise<string> {
  const sorted = files.map((f) => [f.name, f.sha256] as const).sort(([a], [b]) => (a < b ? -1 : 1));
  const text = JSON.stringify([runId, studentId, sorted]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const code = Array.from(digest.subarray(0, 6), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
