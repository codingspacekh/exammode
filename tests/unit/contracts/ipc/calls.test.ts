import { describe, expect, it } from 'vitest';
import { ALL_LISTED, BROWSER_CALLS, CALLS, SIDES, STUDENT_CALLS, TEACHER_CALLS, channel } from '@contracts/ipc/calls';
import { VIEWS } from '@contracts/ipc/api';

describe('the IPC contract (architecture §2.2): the screens\' calls and their channels', () => {
  it('each side\'s calls are listed once, and every call of its API is on the list (calls.ts compiles only then)', () => {
    expect(ALL_LISTED).toEqual([true, true, true]);
    for (const list of [STUDENT_CALLS, TEACHER_CALLS, BROWSER_CALLS]) expect(new Set(list).size).toBe(list.length);
    expect(CALLS).toEqual({ student: STUDENT_CALLS, teacher: TEACHER_CALLS, browser: BROWSER_CALLS });
  });

  it('the channels: the state, its push, and one for each call — the same names for the preload and the main process', () => {
    expect(channel.get('teacher')).toBe('teacher:get');
    expect(channel.state('student')).toBe('student:state');
    expect(channel.call('browser', 'toQuestions')).toBe('browser:toQuestions');
  });

  it('no two calls of all the sides share a channel', () => {
    const all = SIDES.flatMap((side) => [channel.get(side), channel.state(side), ...CALLS[side].map((call) => channel.call(side, call))]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('the windows a renderer can be', () => {
    expect(VIEWS).toEqual(['student', 'teacher', 'bar', 'browser']);
  });
});
