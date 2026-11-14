/**
 * What the teacher's laptop signs (F-44, architecture §2.12), so that a lab computer lists only a licensed
 * teacher's exams and, once it has joined one, believes only that teacher's laptop:
 *
 *   the announcement of an open exam — with the licence in it, which is where the teacher's key comes from;
 *   every message to a student — bound to that connection (the student's `nonce`) and counted (`n`), so one
 *     can't be played again later or to another student;
 *   the answer to a backup or a hand-in — bound to the student's token and to exactly the files that were sent.
 */
import type { Beacon, FileMeta } from '@lib/protocol/messages';
import type { Licence, Trust } from '@lib/trust/licence';
import { fingerprint, sign, verify } from './keys';
import { checkLicence } from './licence';

/** A licensed teacher's laptop: its licence and the private half of its key. */
export interface Identity { licence: Licence; privateKey: string }

/** The announcement, signed: the licence goes with it. */
export function signBeacon(b: Beacon, id: Identity): Beacon {
  const body = { ...b, sig: undefined, teacherKeyFp: fingerprint(id.licence.key), licence: id.licence };
  return { ...body, sig: sign('beacon', body, id.privateKey) };
}

/** Whose exam is this? The teacher's key, when the author licensed it and the announcement is that teacher's;
 *  `null` for a teacher with no licence that a development build takes; nothing: not an exam to list. */
export function teacherOf(b: Beacon, trust: Trust): string | null | undefined {
  const { sig, ...body } = b;
  if (b.licence === undefined || sig === undefined) return trust.allowUnsigned ? null : undefined;
  const checked = checkLicence(b.licence, trust);
  if (!checked.ok || !verify('beacon', body, sig, checked.licence.key)) return undefined;
  return checked.licence.key;
}

/** A message to a student, signed for this connection and counted. */
export function signMessage<T extends object>(msg: T, nonce: string, n: number, privateKey: string): T & { n: number; sig: string } {
  const body = { ...msg, n };
  return { ...body, sig: sign('message', { nonce, msg: body }, privateKey) };
}

/** A message as it came: is it the pinned teacher's, for this connection, and newer than the last one? Its count
 *  if so. */
export function checkMessage(raw: unknown, nonce: string, after: number, key: string): number | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const { sig, ...body } = raw as Record<string, unknown>;
  const n = body.n;
  if (typeof sig !== 'string' || typeof n !== 'number' || !Number.isInteger(n) || n <= after) return undefined;
  return verify('message', { nonce, msg: body }, sig, key) ? n : undefined;
}

/** The teacher's laptop has these files of this student. */
export function signUpload(token: string, kind: 'backup' | 'handIn', files: FileMeta[], privateKey: string): string {
  return sign('upload', { token, kind, files }, privateKey);
}

export function checkUpload(sig: unknown, token: string, kind: 'backup' | 'handIn', files: FileMeta[], key: string): boolean {
  return typeof sig === 'string' && verify('upload', { token, kind, files }, sig, key);
}
