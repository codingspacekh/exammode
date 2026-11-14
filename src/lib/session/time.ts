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

/** Time left as the exam bar shows it: `1:12:40`. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** An exam's length in words: `1 h 30 min`, `45 min`, `2 h`. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} h` : '', m > 0 || h === 0 ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** A time of day on a 24-hour clock: `09:30`. */
export function formatClock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
