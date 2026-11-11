import { describe, expect, it } from 'vitest';
import { clockOffset, endsAt, isTimeUp, teacherTime, timeLeft } from '@lib/session/time';
import { at } from './helpers';

const run = { startedAt: at('09:00'), minutes: 60, extraMinutes: 0 };

describe('F-08 the time is counted from Start', () => {
  it('a 60-minute exam started at 09:00 ends at 10:00', () => {
    expect(endsAt(run)).toBe(at('10:00'));
  });
  it('before Start there is no end yet', () => {
    expect(endsAt({ minutes: 60, extraMinutes: 0 })).toBeUndefined();
  });
  it('F-08 a student who joins 10 minutes late gets the time that is left', () => {
    expect(timeLeft(endsAt(run)!, at('09:10'))).toBe(50 * 60_000);
  });
  it('the time left never goes below zero', () => {
    expect(timeLeft(at('10:00'), at('10:00:05'))).toBe(0);
  });
  it('F-17 time is up at the end, not a second before', () => {
    expect(isTimeUp(at('10:00'), at('09:59:59'))).toBe(false);
    expect(isTimeUp(at('10:00'), at('10:00'))).toBe(true);
  });
});

describe('F-41 add time', () => {
  it('time added for everyone moves the end for everyone', () => {
    expect(endsAt({ ...run, extraMinutes: 10 })).toBe(at('10:10'));
  });
  it('time added for one student moves only their end', () => {
    expect(endsAt({ ...run, extraMinutes: 10 }, { extraMinutes: 5 })).toBe(at('10:15'));
  });
});

describe("§2.8 the students' clocks aren't trusted", () => {
  it('the offset to the teacher is measured from one question and its answer', () => {
    // the student's clock is 90 s behind; the question takes 40 ms each way
    const sent = at('08:58:30');
    expect(clockOffset({ sent, received: sent + 80, teacher: at('09:00:00') + 40 })).toBe(90_000);
  });
  it("the student's clock plus the offset is the teacher's time", () => {
    expect(teacherTime(at('09:28:30'), 90_000)).toBe(at('09:30'));
    expect(timeLeft(at('10:00'), teacherTime(at('09:28:30'), 90_000))).toBe(30 * 60_000);
  });
});
