/**
 * The teacher licence (F-44, architecture §2.12): the author's signature on *this teacher, this key*. A teacher's
 * ExamMode makes a key pair and a request; the author checks who they are and signs a licence (`.emlicence`); every
 * ExamMode carries the author's public key and can check a licence with nothing to ask online. Here: what they
 * are made of. Signing and checking them is in `src/trust` (it needs Node's crypto; `src/lib` has none).
 */
import { z } from 'zod';

const line = (max: number) => z.string().trim().min(1).max(max).refine((s) => !/[\r\n]/.test(s));
const key = z.string().regex(/^[A-Za-z0-9+/]{40,120}={0,2}$/);

/** What a teacher sends the author: who they are, where that can be checked, and the public half of their key. */
export const request = z.object({
  name: line(80), school: line(120), email: z.email().max(120),
  /** where the author can check they are a teacher: the school's staff page, say */
  check: line(200),
  note: z.string().trim().max(500).optional(),
  key,
});
export type Request = z.infer<typeof request>;

const HEAD = 'ExamMode teacher request';
const FIELDS: [label: string, field: keyof Request][] = [['Name', 'name'], ['School', 'school'], ['Email', 'email'], ['Check', 'check'], ['Note', 'note'], ['Key', 'key']];

/** The request as text, to send by email. `about`: the ExamMode and the computer it is from. */
export function requestText(r: Request, about = ''): string {
  const lines = FIELDS.flatMap(([label, field]) => (r[field] ? [`${label}: ${String(r[field]).replace(/\s*[\r\n]+\s*/g, ' ')}`] : []));
  return [HEAD, ...lines, ...(about ? [about] : [])].join('\n');
}

/** The request in an email's text, whatever is around it (a greeting, a quoted reply's `> `). Nothing if there is
 *  none, or it isn't whole. */
export function parseRequest(text: string): Request | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^[>\s]+/, '').trim());
  const from = lines.findIndex((l) => l === HEAD);
  if (from < 0) return undefined;
  const found: Record<string, string> = {};
  for (const l of lines.slice(from + 1)) {
    const at = FIELDS.find(([label]) => l.startsWith(`${label}:`));
    if (at && found[at[1]] === undefined) found[at[1]] = l.slice(at[0].length + 1).trim();
  }
  const parsed = request.safeParse(found);
  return parsed.success ? parsed.data : undefined;
}

/** A teacher licence. `sig`: the author's signature on everything else. */
export const licence = z.object({
  v: z.literal(1), app: z.literal('exammode'),
  /** the licence's number, as the author counts them: `0042` */
  id: z.string().min(1).max(20),
  name: line(80), school: line(120), key,
  issuedAt: z.int().nonnegative(),
  sig: z.string().min(1).max(200),
});
export type Licence = z.infer<typeof licence>;

/** Who ExamMode believes: the author's public keys, and the licences the author took back. */
export interface Trust {
  authorKeys: string[];
  withdrawn?: string[];
  /** a development build also takes a teacher with no licence at all; never an installed ExamMode */
  allowUnsigned?: boolean;
}

export type LicenceCheck =
  | { ok: true; licence: Licence }
  | { ok: false; why: 'invalid' | 'notFromAuthor' | 'withdrawn' | 'otherComputer' };
