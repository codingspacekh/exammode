/**
 * The classroom protocol (architecture §2.7): one zod definition, shared by both sides. Every message carries `v`;
 * an older client is told to update. Parts a message doesn't know are dropped, so a newer client can add to one
 * without bumping `v` — bump it only when an old client can't ignore the change.
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

const v = z.int();
const id = z.string().min(1);
const time = z.int().nonnegative();

/** A file by name, size and SHA-256 (F-16, F-22). */
export const fileMeta = z.object({ name: z.string().min(1), bytes: z.int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });
export type FileMeta = z.infer<typeof fileMeta>;

const logEntry = z.object({ at: time, kind: id, details: z.record(z.string(), z.unknown()) });

export const fromStudent = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('join'), runId: id, studentId: id, code: z.string().regex(/^\d{4}$/), pc: id, instanceId: id, bootId: id }),
  z.object({ v, type: z.literal('resume'), token: id, instanceId: id, localLog: z.array(logEntry) }),
  z.object({ v, type: z.literal('checks'), results: z.array(z.object({ check: id, ok: z.boolean() })) }),
  z.object({ v, type: z.literal('ready') }),
  z.object({ v, type: z.literal('beat'), seq: z.int().nonnegative(), front: z.string().optional() }),
  z.object({ v, type: z.literal('event'), kind: id, details: z.record(z.string(), z.unknown()) }),
  z.object({ v, type: z.literal('leave') }),
]);
export type FromStudent = z.infer<typeof fromStudent>;

/** What a student's ExamMode needs to know about the exam it joined. */
export const examInfo = z.object({
  title: id, teacher: id, class: id, minutes: z.int().positive(),
  websites: z.array(z.object({ url: z.string(), hosts: z.array(z.string()) })),
});
export type ExamInfo = z.infer<typeof examInfo>;

export const refusedReason = z.enum(['codeWrong', 'nameTaken', 'notInClass', 'left', 'keptOut', 'handedIn', 'notJoined', 'ended', 'update']);
export type RefusedReason = z.infer<typeof refusedReason>;

export const fromTeacher = z.discriminatedUnion('type', [
  // `now` is the teacher's clock, for the student's offset to it (§2.8). It is also what a student who waits
  // after `refused: left` hears when the teacher lets them back in (F-40)
  z.object({ v, type: z.literal('joined'), token: id, now: time, state: z.enum(['checking', 'ready', 'inExam']), endsAt: time.optional(), exam: examInfo.optional() }),
  z.object({ v, type: z.literal('refused'), reason: refusedReason }),
  z.object({ v, type: z.literal('start'), endsAt: time }),
  z.object({ v, type: z.literal('time'), endsAt: time }),
  z.object({ v, type: z.literal('end') }),
  z.object({ v, type: z.literal('unlock') }),
  z.object({ v, type: z.literal('receipt'), code: z.string().regex(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/), files: z.array(fileMeta) }),
]);
export type FromTeacher = z.infer<typeof fromTeacher>;

/** Finding exams (F-01): broadcast by the teacher's laptop every 2 s. The key's fingerprint comes with M7. */
export const beacon = z.object({
  v, runId: id, title: id, teacher: id, class: id, minutes: z.int().positive().optional(), port: z.int().min(1).max(65_535), teacherKeyFp: z.string().nullable(),
});
export type Beacon = z.infer<typeof beacon>;

/** Guard → teacher, over HTTP, when ExamMode's process ends without unlocking (F-20). */
export const stopped = z.object({ v, type: z.literal('stopped'), token: id, pc: id, instanceId: id, at: time });
export type Stopped = z.infer<typeof stopped>;

/** What comes with the files of a backup or a hand-in (HTTP, multipart). */
export const upload = z.object({ v, token: id, kind: z.enum(['backup', 'handIn']), files: z.array(fileMeta) });
export type Upload = z.infer<typeof upload>;

export type Parsed<T> = { ok: true; msg: T } | { ok: false; reason: 'older' | 'newer' | 'invalid' };

function parse<T>(schema: z.ZodType<T>, raw: unknown): Parsed<T> {
  const version = z.object({ v }).safeParse(raw);
  if (!version.success) return { ok: false, reason: 'invalid' };
  if (version.data.v !== PROTOCOL_VERSION) return { ok: false, reason: version.data.v < PROTOCOL_VERSION ? 'older' : 'newer' };
  const result = schema.safeParse(raw);
  return result.success ? { ok: true, msg: result.data } : { ok: false, reason: 'invalid' };
}

export const parseFromStudent = (raw: unknown): Parsed<FromStudent> => parse(fromStudent, raw);
export const parseFromTeacher = (raw: unknown): Parsed<FromTeacher> => parse(fromTeacher, raw);

/** The answer to an older client: update ExamMode. */
export const updateReply = (): FromTeacher => ({ v: PROTOCOL_VERSION, type: 'refused', reason: 'update' });
