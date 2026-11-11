/**
 * The exam's time (F-08, F-17, F-41). The end comes from the teacher's laptop; the students' clocks aren't trusted
 * (architecture §2.8): each ExamMode measures its offset to the teacher's clock when it joins. All times are ms.
 */

export interface RunClock { startedAt?: number; minutes: number; extraMinutes: number }

/** When the exam ends for a student: counted from Start, plus the time added for everyone and for them. */
export function endsAt(run: RunClock, attempt: { extraMinutes: number } = { extraMinutes: 0 }): number | undefined {
  if (run.startedAt === undefined) return undefined;
  return run.startedAt + (run.minutes + run.extraMinutes + attempt.extraMinutes) * 60_000;
}

/** A late joiner gets what is left (F-08). Never below zero. */
export const timeLeft = (end: number, now: number): number => Math.max(0, end - now);

export const isTimeUp = (end: number, now: number): boolean => now >= end;

/** What to add to this computer's clock to get the teacher's: from one question (sent, received) and the
 *  teacher's time in its answer, taken to be halfway between. */
export function clockOffset(q: { sent: number; received: number; teacher: number }): number {
  return Math.round(q.teacher - (q.sent + q.received) / 2);
}

export const teacherTime = (localNow: number, offset: number): number => localNow + offset;
