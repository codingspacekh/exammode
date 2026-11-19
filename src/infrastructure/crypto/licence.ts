/**
 * Signing and checking a teacher licence (F-44, architecture §2.12). What a licence is made of is in
 * `src/domain/trust/licence.ts`.
 */
import { licence, type Licence, type LicenceCheck, type Request, type Trust } from '@domain/trust/licence';
import { sign, verify } from './keys';

/** The author signs: this teacher, this key. */
export function issue(r: Pick<Request, 'name' | 'school' | 'key'>, id: string, at: number, authorKey: string): Licence {
  const body = { v: 1 as const, app: 'exammode' as const, id, name: r.name.trim(), school: r.school.trim(), key: r.key, issuedAt: at };
  return licence.parse({ ...body, sig: sign('licence', body, authorKey) });
}

/** Is this a licence the author signed — and, on a teacher's own laptop, one for `key`, this computer's key? */
export function checkLicence(raw: unknown, trust: Trust, forKey?: string): LicenceCheck {
  const parsed = licence.safeParse(raw);
  if (!parsed.success) return { ok: false, why: 'invalid' };
  const { sig, ...body } = parsed.data;
  if (!trust.authorKeys.some((author) => verify('licence', body, sig, author))) return { ok: false, why: 'notFromAuthor' };
  if (trust.withdrawn?.includes(body.id)) return { ok: false, why: 'withdrawn' };
  if (forKey !== undefined && forKey !== body.key) return { ok: false, why: 'otherComputer' };
  return { ok: true, licence: parsed.data };
}
