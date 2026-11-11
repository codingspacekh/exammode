import { describe, expect, it } from 'vitest';
import {
  addTime, onBeat, onChecks, onEvent, onHandIn, onJoin, onKeepOut, onLeave, onLetBackIn, onReady, onResume, onStart,
  onStopped, onTick,
} from '@lib/session/attempt';
import { at, attempt, seat } from './helpers';

const kinds = (r: { events: { kind: string }[] }) => r.events.map((e) => e.kind);
const JOINED = { type: 'joined' };

/** Every row of the architecture's §2.8, and the states of the requirements' §1.3. */
describe('F-02 joining', () => {
  it('a student who has not joined is checking after Join', () => {
    const r = onJoin(attempt(), seat(), at('08:55'));
    expect(r.attempt).toMatchObject({ state: 'checking', pc: 'PC-07', instanceId: 'i-1', bootId: 'b-1', joinedAt: at('08:55') });
    expect(r.reply).toEqual(JOINED);
    expect(kinds(r)).toEqual(['joined']);
  });
  it('F-02 a name already in this run on another computer is refused: name taken', () => {
    for (const state of ['checking', 'ready', 'inExam'] as const) {
      const a = attempt({ state });
      const r = onJoin(a, seat({ pc: 'PC-12', instanceId: 'i-9', bootId: 'b-9' }), at('09:31'));
      expect(r.attempt).toBe(a);
      expect(r.reply).toEqual({ type: 'refused', reason: 'nameTaken' });
      expect(r.events).toEqual([{ kind: 'nameTaken', at: at('09:31'), details: { pc: 'PC-12' } }]);
    }
  });
  it('the same ExamMode joining twice changes nothing', () => {
    for (const state of ['checking', 'ready', 'inExam'] as const) {
      const a = attempt({ state });
      const r = onJoin(a, seat(), at('09:30:01'));
      expect(r.attempt.state).toBe(state);
      expect(r.reply).toEqual(JOINED);
      expect(r.events).toEqual([]);
    }
  });
  it('a student who handed in is refused', () => {
    const a = attempt({ state: 'handedIn' });
    expect(onJoin(a, seat({ instanceId: 'i-2' }), at('10:00'))).toEqual({ attempt: a, events: [], reply: { type: 'refused', reason: 'handedIn' } });
  });
});

describe('F-04 the checks', () => {
  it('a failed check is shown to the teacher; the student stays checking', () => {
    const r = onChecks(attempt({ state: 'checking' }), [{ check: 'oneScreen', ok: false }, { check: 'noRemote', ok: true }], at('08:56'));
    expect(r.attempt.state).toBe('checking');
    expect(r.attempt.checks).toEqual([{ check: 'oneScreen', ok: false }, { check: 'noRemote', ok: true }]);
    expect(r.events).toEqual([{ kind: 'checkFailed', at: at('08:56'), details: { check: 'oneScreen' } }]);
  });
  it('checks from a student who is not checking are ignored', () => {
    const a = attempt({ state: 'inExam' });
    expect(onChecks(a, [{ check: 'oneScreen', ok: false }], at('09:31'))).toEqual({ attempt: a, events: [] });
  });
  it('checks pass → ready', () => {
    const r = onReady(attempt({ state: 'checking' }), at('08:57'), { started: false });
    expect(r.attempt.state).toBe('ready');
    expect(kinds(r)).toEqual(['ready']);
  });
  it('ready from a student who is not checking is ignored', () => {
    const a = attempt({ state: 'inExam' });
    expect(onReady(a, at('09:31'), { started: true })).toEqual({ attempt: a, events: [] });
  });
});

describe('F-08 Start', () => {
  it('Start puts every ready student in the exam', () => {
    const r = onStart(attempt({ state: 'ready' }), at('09:00'));
    expect(r.attempt).toMatchObject({ state: 'inExam', lastBeatAt: at('09:00') });
    expect(kinds(r)).toEqual(['started']);
  });
  it('Start leaves a student who is still checking where they are', () => {
    const a = attempt({ state: 'checking' });
    expect(onStart(a, at('09:00'))).toEqual({ attempt: a, events: [] });
  });
  it('a late joiner is in the exam as soon as their checks pass', () => {
    const r = onReady(attempt({ state: 'checking' }), at('09:10'), { started: true });
    expect(r.attempt).toMatchObject({ state: 'inExam', lastBeatAt: at('09:10') });
    expect(kinds(r)).toEqual(['ready', 'joinedLate']);
  });
});

describe('F-18 before Start, leaving or stopping only takes the student off the list', () => {
  const off = { state: 'notJoined', extraMinutes: 0, warnings: 0 };
  it('F-18 a stop before Start only takes the student off the list', () => {
    for (const state of ['checking', 'ready'] as const) {
      const r = onStopped(attempt({ state }), { instanceId: 'i-1' }, at('08:58'));
      expect(r.attempt).toEqual(off);
      expect(r.events).toEqual([{ kind: 'leftBeforeStart', at: at('08:58'), details: { how: 'stoppedSuddenly', pc: 'PC-07' } }]);
    }
  });
  it('Leave before Start: off the list', () => {
    const r = onLeave(attempt({ state: 'ready' }), at('08:58'));
    expect(r.attempt).toEqual(off);
    expect(r.events[0]?.details).toEqual({ how: 'pressedLeave', pc: 'PC-07' });
  });
  it('a lost connection before Start (no beat for 10 s): off the list', () => {
    const a = attempt({ state: 'ready', lastBeatAt: at('08:58:00') });
    expect(onTick(a, at('08:58:09')).attempt).toBe(a);
    const r = onTick(a, at('08:58:10'));
    expect(r.attempt).toEqual(off);
    expect(r.events[0]?.details).toEqual({ how: 'noContact', pc: 'PC-07' });
  });
  it('they can join again, on any computer', () => {
    const gone = onLeave(attempt({ state: 'ready' }), at('08:58')).attempt;
    const r = onJoin(gone, seat({ pc: 'PC-12', instanceId: 'i-2' }), at('08:59'));
    expect(r.attempt).toMatchObject({ state: 'checking', pc: 'PC-12' });
    expect(r.reply).toEqual(JOINED);
  });
  it('ExamMode started again on the same computer before Start: the checks run again', () => {
    const r = onJoin(attempt({ state: 'ready' }), seat({ instanceId: 'i-2' }), at('08:59'));
    expect(r.attempt).toMatchObject({ state: 'checking', instanceId: 'i-2' });
    expect(r.reply).toEqual(JOINED);
    expect(kinds(r)).toEqual(['joined']);
  });
  it('extra time given before Start is kept', () => {
    expect(onLeave(attempt({ state: 'ready', extraMinutes: 10 }), at('08:58')).attempt.extraMinutes).toBe(10);
  });
});

describe('F-15 Leave', () => {
  it('Leave, confirmed, in the exam → left (pressed Leave)', () => {
    const r = onLeave(attempt({ state: 'inExam' }), at('09:40'));
    expect(r.attempt).toMatchObject({ state: 'left', leftHow: 'pressedLeave', leftAt: at('09:40') });
    expect(r.events).toEqual([{ kind: 'left', at: at('09:40'), details: {} }]);
  });
  it('Leave from a student who already left or handed in is ignored', () => {
    for (const state of ['left', 'handedIn', 'notJoined'] as const) {
      const a = attempt({ state });
      expect(onLeave(a, at('09:40'))).toEqual({ attempt: a, events: [] });
    }
  });
});

describe('F-19 no contact', () => {
  it('F-19 no beat for 10 s → no contact; nothing is decided yet', () => {
    const a = attempt({ state: 'inExam', lastBeatAt: at('09:30:00') });
    expect(onTick(a, at('09:30:09')).attempt).toBe(a);
    const r = onTick(a, at('09:30:10'));
    expect(r.attempt.state).toBe('noContact');
    expect(r.events).toEqual([{ kind: 'noContact', at: at('09:30:10'), details: { since: at('09:30:00') } }]);
  });
  it('a beat keeps the student in the exam, with the app in front', () => {
    const r = onBeat(attempt({ state: 'inExam' }), { front: 'Word' }, at('09:30:02'));
    expect(r.attempt).toMatchObject({ state: 'inExam', lastBeatAt: at('09:30:02'), front: 'Word' });
    expect(r.events).toEqual([]);
  });
  it('a beat before Start keeps the student on the list', () => {
    const r = onBeat(attempt({ state: 'ready', lastBeatAt: at('08:58:00') }), {}, at('08:58:02'));
    expect(onTick(r.attempt, at('08:58:11')).attempt.state).toBe('ready');
  });
  it('a beat or a tick for a student who left changes nothing', () => {
    const a = attempt({ state: 'left' });
    expect(onBeat(a, {}, at('09:50'))).toEqual({ attempt: a, events: [] });
    expect(onTick(a, at('09:50'))).toEqual({ attempt: a, events: [] });
  });
  it('Q6 a resume with the same instanceId after a gap is not leaving: in the exam, with the gap and its local log', () => {
    const a = attempt({ state: 'noContact', lastBeatAt: at('09:57:00') });
    const localLog = [{ at: at('09:57:20'), kind: 'appClosed', details: { app: 'Notepad' } }];
    const r = onResume(a, { instanceId: 'i-1', localLog }, at('09:57:45'));
    expect(r.attempt).toMatchObject({ state: 'inExam', lastBeatAt: at('09:57:45') });
    expect(r.reply).toEqual(JOINED);
    expect(r.events).toEqual([{ kind: 'gap', at: at('09:57:45'), details: { from: at('09:57:00'), seconds: 45, localLog } }]);
  });
  it('beats again after no contact → in the exam, with a gap in the log', () => {
    const r = onBeat(attempt({ state: 'noContact', lastBeatAt: at('09:57:00') }), { front: 'Word' }, at('09:57:30'));
    expect(r.attempt).toMatchObject({ state: 'inExam', front: 'Word' });
    expect(r.events).toEqual([{ kind: 'gap', at: at('09:57:30'), details: { from: at('09:57:00'), seconds: 30, localLog: [] } }]);
  });
  it('a join from the same ExamMode after no contact is a resume', () => {
    const r = onJoin(attempt({ state: 'noContact' }), seat(), at('09:31'));
    expect(r.attempt.state).toBe('inExam');
    expect(kinds(r)).toEqual(['gap']);
  });
  it('a quick reconnect (under 10 s) is not a gap', () => {
    const r = onResume(attempt({ state: 'inExam' }), { instanceId: 'i-1', localLog: [] }, at('09:30:04'));
    expect(r.attempt).toMatchObject({ state: 'inExam', lastBeatAt: at('09:30:04') });
    expect(r.events).toEqual([]);
    expect(r.reply).toEqual(JOINED);
  });
  it('a resume before Start keeps the student on the list', () => {
    const r = onResume(attempt({ state: 'ready' }), { instanceId: 'i-1', localLog: [] }, at('08:59'));
    expect(r.attempt).toMatchObject({ state: 'ready', lastBeatAt: at('08:59') });
    expect(r.reply).toEqual(JOINED);
  });
  it('a resume that cannot be one is refused, and changes nothing', () => {
    const cases = [
      [attempt(), 'notJoined'], [attempt({ state: 'left' }), 'left'], [attempt({ state: 'handedIn' }), 'handedIn'],
      [attempt({ state: 'inExam', instanceId: 'i-0' }), 'notJoined'],
    ] as const;
    for (const [a, reason] of cases) {
      expect(onResume(a, { instanceId: 'i-1', localLog: [] }, at('09:31'))).toEqual({ attempt: a, events: [], reply: { type: 'refused', reason } });
    }
  });
});

describe('N-05 after the teacher\'s laptop restarts, the last beat is not known', () => {
  it('the 10 s are counted from the first tick', () => {
    const first = onTick(attempt({ state: 'inExam', lastBeatAt: undefined }), at('09:30:00'));
    expect(first.attempt).toMatchObject({ state: 'inExam', lastBeatAt: at('09:30:00') });
    expect(onTick(first.attempt, at('09:30:10')).attempt.state).toBe('noContact');
  });
  it('a stop, a gap and a return are counted from now', () => {
    const a = attempt({ state: 'noContact', lastBeatAt: undefined });
    expect(onStopped(a, { instanceId: 'i-1' }, at('09:42')).attempt.leftAt).toBe(at('09:42'));
    expect(onJoin(a, seat({ instanceId: 'i-2' }), at('09:42')).attempt.leftAt).toBe(at('09:42'));
    expect(onBeat(a, {}, at('09:42')).events[0]?.details).toMatchObject({ from: at('09:42'), seconds: 0 });
    const back = onLetBackIn(attempt({ state: 'left', asksBack: seat() }), { reason: '' }, at('09:42'));
    expect(back.events[1]?.details).toMatchObject({ secondsOut: 0 });
  });
});

describe('F-20 stopped suddenly', () => {
  it("the Guard's stopped → left (stopped suddenly), from the last beat", () => {
    const r = onStopped(attempt({ state: 'inExam', lastBeatAt: at('09:41:58') }), { instanceId: 'i-1' }, at('09:42'));
    expect(r.attempt).toMatchObject({ state: 'left', leftHow: 'stoppedSuddenly', leftAt: at('09:41:58') });
    expect(r.events).toEqual([{ kind: 'stoppedSuddenly', at: at('09:42'), details: {} }]);
  });
  it('a stopped about another ExamMode, or after leaving, is ignored', () => {
    const a = attempt({ state: 'inExam' });
    expect(onStopped(a, { instanceId: 'i-0' }, at('09:42'))).toEqual({ attempt: a, events: [] });
    const left = attempt({ state: 'left', leftHow: 'pressedLeave' });
    expect(onStopped(left, { instanceId: 'i-1' }, at('09:42'))).toEqual({ attempt: left, events: [] });
  });
  it('F-20 a join with a new instanceId while in the exam means ExamMode had stopped', () => {
    const a = attempt({ state: 'inExam', instanceId: 'i-1', bootId: 'b-1' });
    const r = onJoin(a, { instanceId: 'i-2', bootId: 'b-1', pc: 'PC-07' }, at('09:59'));
    expect(r.attempt.state).toBe('left');
    expect(r.attempt.leftHow).toBe('stoppedSuddenly');
    expect(r.reply).toEqual({ type: 'refused', reason: 'left' });
    expect(kinds(r)).toEqual(['stoppedSuddenly', 'asksBack']);
    expect(r.events[0]?.details).toEqual({});
    expect(r.attempt.asksBack).toEqual({ instanceId: 'i-2', bootId: 'b-1', pc: 'PC-07' });
  });
  it('F-20 a new bootId as well adds: the computer was restarted', () => {
    const r = onJoin(attempt({ state: 'noContact' }), seat({ instanceId: 'i-2', bootId: 'b-2' }), at('09:59'));
    expect(r.attempt.state).toBe('left');
    expect(r.events[0]).toEqual({ kind: 'stoppedSuddenly', at: at('09:59'), details: { restarted: true } });
  });
  it('F-20 no contact, then a join from another computer: ExamMode had stopped there', () => {
    const r = onJoin(attempt({ state: 'noContact' }), seat({ pc: 'PC-12', instanceId: 'i-2', bootId: 'b-9' }), at('09:59'));
    expect(r.attempt).toMatchObject({ state: 'left', leftHow: 'stoppedSuddenly', pc: 'PC-07' });
    expect(r.events[0]?.details).toEqual({});
    expect(r.reply).toEqual({ type: 'refused', reason: 'left' });
  });
});

describe('F-18 a student who left cannot join again', () => {
  it('F-18 a join after leaving is refused and the teacher told', () => {
    const a = attempt({ state: 'left', leftHow: 'pressedLeave', leftAt: at('09:40') });
    const r = onJoin(a, seat({ pc: 'PC-12', instanceId: 'i-2', bootId: 'b-9' }), at('09:45'));
    expect(r.attempt.state).toBe('left');
    expect(r.reply).toEqual({ type: 'refused', reason: 'left' });
    expect(r.events).toEqual([{ kind: 'asksBack', at: at('09:45'), details: { pc: 'PC-12' } }]);
  });
  it('F-40 Let back in accepts the waiting join: in the exam on that computer, the time out logged', () => {
    const left = attempt({ state: 'left', leftHow: 'stoppedSuddenly', leftAt: at('09:40'), warnings: 2, extraMinutes: 5 });
    const asked = onJoin(left, seat({ pc: 'PC-12', instanceId: 'i-2', bootId: 'b-9' }), at('09:45')).attempt;
    const r = onLetBackIn(asked, { reason: 'The power went off' }, at('09:46:30'));
    expect(r.attempt).toEqual({
      state: 'inExam', pc: 'PC-12', instanceId: 'i-2', bootId: 'b-9', joinedAt: at('09:00'), lastBeatAt: at('09:46:30'),
      warnings: 2, extraMinutes: 5,
    });
    expect(r.reply).toEqual(JOINED);
    expect(r.events).toEqual([
      { kind: 'letBackIn', at: at('09:46:30'), details: { reason: 'The power went off' } },
      { kind: 'cameBack', at: at('09:46:30'), details: { pc: 'PC-12', secondsOut: 390 } },
    ]);
  });
  it('F-40 Let back in before the student asks: their next join is accepted', () => {
    const left = attempt({ state: 'left', leftHow: 'pressedLeave', leftAt: at('09:40') });
    const let_ = onLetBackIn(left, { reason: 'Pressed it by mistake' }, at('09:41'));
    expect(let_.attempt.state).toBe('left');
    expect(let_.reply).toBeUndefined();
    expect(kinds(let_)).toEqual(['letBackIn']);
    const r = onJoin(let_.attempt, seat({ instanceId: 'i-2' }), at('09:42'));
    expect(r.attempt.state).toBe('inExam');
    expect(r.reply).toEqual(JOINED);
    expect(r.events).toEqual([{ kind: 'cameBack', at: at('09:42'), details: { pc: 'PC-07', secondsOut: 120 } }]);
  });
  it('F-40 Keep out, with a reason: the waiting join is refused and the student stays out', () => {
    const asked = onJoin(attempt({ state: 'left', leftAt: at('09:40') }), seat({ instanceId: 'i-2' }), at('09:45')).attempt;
    const r = onKeepOut(asked, { reason: 'Left the room' }, at('09:46'));
    expect(r.attempt.state).toBe('left');
    expect(r.attempt.asksBack).toBeUndefined();
    expect(r.reply).toEqual({ type: 'refused', reason: 'keptOut' });
    expect(r.events).toEqual([{ kind: 'keptOut', at: at('09:46'), details: { reason: 'Left the room' } }]);
  });
  it('F-40 Keep out takes back an earlier Let back in', () => {
    const let_ = onLetBackIn(attempt({ state: 'left', leftAt: at('09:40') }), { reason: '' }, at('09:41')).attempt;
    const kept = onKeepOut(let_, { reason: 'Changed my mind' }, at('09:42'));
    expect(kept.reply).toBeUndefined();
    expect(onJoin(kept.attempt, seat({ instanceId: 'i-2' }), at('09:43')).reply).toEqual({ type: 'refused', reason: 'left' });
  });
  it('Let back in and Keep out do nothing for a student who has not left', () => {
    const a = attempt({ state: 'inExam' });
    expect(onLetBackIn(a, { reason: '' }, at('09:41'))).toEqual({ attempt: a, events: [] });
    expect(onKeepOut(a, { reason: '' }, at('09:41'))).toEqual({ attempt: a, events: [] });
  });
});

describe('F-16 hand in · F-17 time up', () => {
  it('Hand in → handed in, with how and when', () => {
    const r = onHandIn(attempt({ state: 'inExam' }), 'handIn', at('09:50'));
    expect(r.attempt).toMatchObject({ state: 'handedIn', handedInAt: at('09:50'), handedInHow: 'handIn' });
    expect(r.events).toEqual([{ kind: 'handedIn', at: at('09:50'), details: { how: 'handIn' } }]);
  });
  it('F-17 at time up a student with no contact is handed in too', () => {
    expect(onHandIn(attempt({ state: 'noContact' }), 'timeUp', at('10:00')).attempt).toMatchObject({ state: 'handedIn', handedInHow: 'timeUp' });
  });
  it('a student who left stays left at time up (their last backup is their hand-in)', () => {
    const a = attempt({ state: 'left' });
    expect(onHandIn(a, 'timeUp', at('10:00'))).toEqual({ attempt: a, events: [] });
  });
});

describe('F-12 F-13 warnings and notes', () => {
  it('F-12 a closed app is a warning on a student in the exam', () => {
    const r = onEvent(attempt({ state: 'inExam', warnings: 1 }), { kind: 'appClosed', details: { app: 'Chrome' } }, at('09:35'));
    expect(r.attempt.warnings).toBe(2);
    expect(r.events).toEqual([{ kind: 'appClosed', at: at('09:35'), details: { app: 'Chrome' } }]);
  });
  it('F-04 a second screen plugged in during the exam is a warning', () => {
    expect(onEvent(attempt({ state: 'inExam' }), { kind: 'displayAdded', details: {} }, at('09:35')).attempt.warnings).toBe(1);
  });
  it('F-13 a blocked page is a note, not a warning', () => {
    const r = onEvent(attempt({ state: 'inExam' }), { kind: 'pageBlocked', details: { url: 'https://chatgpt.com/' } }, at('09:35'));
    expect(r.attempt.warnings).toBe(0);
    expect(r.events.map((e) => e.kind)).toEqual(['pageBlocked']);
  });
  it('an app closed during the checks (F-05) is logged, not counted', () => {
    const r = onEvent(attempt({ state: 'checking' }), { kind: 'appClosed', details: { app: 'Chrome' } }, at('08:56'));
    expect(r.attempt.warnings).toBe(0);
    expect(r.events).toHaveLength(1);
  });
});

describe('F-41 add time', () => {
  it('extra minutes for one student add up and are logged', () => {
    const r = addTime(addTime(attempt({ state: 'inExam' }), 5, at('09:50')).attempt, 10, at('09:55'));
    expect(r.attempt.extraMinutes).toBe(15);
    expect(r.events).toEqual([{ kind: 'timeAdded', at: at('09:55'), details: { minutes: 10 } }]);
  });
});
