import type { Attempt, Seat } from '@lib/session/attempt';

/** A time on the exam's day, as the teacher's clock in ms: at('09:59') or at('09:59:30'). */
export function at(clock: string): number {
  const [h = 0, m = 0, s = 0] = clock.split(':').map(Number);
  return Date.UTC(2026, 10, 12, h, m, s);
}

/** An attempt for a test: Dara on PC-07, joined at 09:00, last heard from at 09:30. */
export function attempt(over: Partial<Attempt> = {}): Attempt {
  const base: Attempt = { state: 'notJoined', extraMinutes: 0, warnings: 0 };
  if (over.state === undefined || over.state === 'notJoined') return { ...base, ...over };
  return { ...base, pc: 'PC-07', instanceId: 'i-1', bootId: 'b-1', joinedAt: at('09:00'), lastBeatAt: at('09:30'), ...over };
}

export const seat = (over: Partial<Seat> = {}): Seat => ({ pc: 'PC-07', instanceId: 'i-1', bootId: 'b-1', ...over });
