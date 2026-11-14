/**
 * The classroom protocol (architecture §2.7): one zod definition, shared by both sides. Every message carries `v`;
 * an older client is told to update. Parts a message doesn't know are dropped, so a newer client can add to one
 * without bumping `v` — bump it only when an old client can't ignore the change.
 */
import { z } from 'zod';
import { examApp } from '../profiles/exam-apps';
import { installedApp, MAX_APPS } from '../profiles/inventory';
import { licence } from '../trust/licence';

export const PROTOCOL_VERSION = 1;

const v = z.int();
/** Every word and list from the network has a size: nothing a computer sends can fill the teacher's log or disk. */
const id = z.string().min(1).max(200);
export const MAX_DETAILS = 2000;
const details = z.record(z.string().max(60), z.unknown()).refine((d) => JSON.stringify(d).length <= MAX_DETAILS, 'too long');
/** How many files one request may carry, and how many a hand-in may list (the ones the teacher's laptop already
 *  has from a backup aren't sent again). */
export const MAX_FILES = 500;
export const MAX_LISTED = 20_000;
export const MAX_LOCAL_LOG = 500;
/** One file at most; a bigger one isn't sent, and the teacher is told. */
export const MAX_FILE_BYTES = 500 * 1024 * 1024;
const time = z.int().nonnegative();
/** A run's id is a UUID, and nothing else: it becomes part of folder names and of a command on the lab computer. */
const runId = z.uuid();

/** A file by name, size and SHA-256 (F-16, F-22). */
export const fileMeta = z.object({ name: z.string().min(1).max(400), bytes: z.int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });
export type FileMeta = z.infer<typeof fileMeta>;

const kind = z.string().min(1).max(60);
const logEntry = z.object({ at: time, kind, details });

/** A join's or a return's own random word: the teacher's signatures on this connection's messages are bound to it
 *  (F-44). */
const nonce = z.string().min(8).max(100).optional();

export const fromStudent = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('join'), runId, studentId: id, code: z.string().regex(/^\d{4}$/), pc: id.max(80), instanceId: id, bootId: id, nonce }),
  z.object({ v, type: z.literal('resume'), token: id, instanceId: id, localLog: z.array(logEntry).max(MAX_LOCAL_LOG), nonce }),
  z.object({ v, type: z.literal('checks'), results: z.array(z.object({ check: z.string().min(1).max(60), ok: z.boolean() })).max(40) }),
  z.object({ v, type: z.literal('ready') }),
  z.object({ v, type: z.literal('beat'), seq: z.int().nonnegative(), front: z.string().max(300).optional() }),
  z.object({ v, type: z.literal('event'), kind, details }),
  z.object({ v, type: z.literal('leave') }),
]);
export type FromStudent = z.infer<typeof fromStudent>;

/** What a student's ExamMode needs to know about the exam it joined. */
export const examInfo = z.object({
  title: id, teacher: id, class: id, minutes: z.int().positive(),
  websites: z.array(z.object({ url: z.string(), hosts: z.array(z.string()) })),
  /** the exam's apps (F-31): what the lock lets stay, and what the exam bar can start */
  apps: z.array(examApp).optional(),
  /** the files the teacher gives every student: fetched into the Exam folder at Start (§2.9) */
  files: z.array(fileMeta).optional(),
});
export type ExamInfo = z.infer<typeof examInfo>;

export const refusedReason = z.enum(['codeWrong', 'nameTaken', 'notInClass', 'left', 'keptOut', 'handedIn', 'notJoined', 'ended', 'update']);
export type RefusedReason = z.infer<typeof refusedReason>;

export const fromTeacher = z.discriminatedUnion('type', [
  // `now` is the teacher's clock, for the student's offset to it (§2.8). It is also what a student who waits
  // after `refused: left` hears when the teacher lets them back in (F-40)
  z.object({ v, type: z.literal('joined'), token: id, now: time, state: z.enum(['checking', 'ready', 'inExam']), endsAt: time.optional(), exam: examInfo.optional() }),
  // `left`: for a student who left, when and how — what screen 10 tells them (F-18)
  z.object({ v, type: z.literal('refused'), reason: refusedReason, left: z.object({ at: time, how: z.enum(['pressedLeave', 'stoppedSuddenly']), pc: z.string() }).optional() }),
  z.object({ v, type: z.literal('start'), endsAt: time }),
  z.object({ v, type: z.literal('time'), endsAt: time }),
  z.object({ v, type: z.literal('end') }),
  z.object({ v, type: z.literal('unlock') }),
  z.object({ v, type: z.literal('receipt'), code: z.string().regex(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/), files: z.array(fileMeta) }),
]);
export type FromTeacher = z.infer<typeof fromTeacher>;

/** Finding exams (F-01): broadcast by the teacher's laptop every 2 s. A licensed teacher's carries the licence
 *  and the teacher's signature on everything else in it (F-44) — parts this version doesn't know are kept, as
 *  they were signed too. */
export const beacon = z.looseObject({
  v, runId, title: id, teacher: id, class: id, minutes: z.int().positive().optional(), port: z.int().min(1).max(65_535), teacherKeyFp: z.string().nullable(),
  licence: licence.optional(), sig: z.string().max(200).optional(),
});
export type Beacon = z.infer<typeof beacon>;

/** Guard → teacher, over HTTP, when ExamMode's process ends without unlocking (F-20). */
export const stopped = z.object({ v, type: z.literal('stopped'), token: id, pc: id, instanceId: id, at: time });
export type Stopped = z.infer<typeof stopped>;

/** A lab computer says what it has installed (F-31a): `POST /inventory`, when it finds a teacher's laptop. */
export const inventory = z.object({ v, pc: id.max(80), profiles: z.array(z.string().min(1).max(60)).max(60), apps: z.array(installedApp).max(MAX_APPS) });
export type Inventory = z.infer<typeof inventory>;

/** What comes with the files of a backup or a hand-in (HTTP, multipart). */
export const upload = z.object({ v, token: id, kind: z.enum(['backup', 'handIn']), files: z.array(fileMeta).max(MAX_LISTED) });
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
