/**
 * A student's attempt at a run, as the teacher's laptop sees it (architecture §2.8, D5): left, stopped suddenly or
 * no contact — the rule behind F-15, F-18, F-19 and F-20. Pure: every function takes the attempt and what was seen,
 * and returns the new attempt, the events for the log, and the reply to the student (if any).
 */

export type AttemptState = 'notJoined' | 'checking' | 'ready' | 'inExam' | 'noContact' | 'left' | 'handedIn';
export type LeftHow = 'pressedLeave' | 'stoppedSuddenly';
export type HandInHow = 'handIn' | 'timeUp' | 'ended';

/** Where a student sits: `instanceId` is new for every ExamMode start, `bootId` for every Windows boot. */
export interface Seat { pc: string; instanceId: string; bootId: string }
export interface CheckResult { check: string; ok: boolean }

export interface Attempt {
  state: AttemptState;
  pc?: string;
  instanceId?: string;
  bootId?: string;
  joinedAt?: number;
  lastBeatAt?: number;
  /** the app in front, from the last beat */
  front?: string;
  checks?: CheckResult[];
  leftAt?: number;
  leftHow?: LeftHow;
  /** a refused join that waits for the teacher's Let back in or Keep out */
  asksBack?: Seat;
  /** the teacher said Let back in before the student asked */
  mayReturn?: boolean;
  handedInAt?: number;
  handedInHow?: HandInHow;
  extraMinutes: number;
  warnings: number;
}

export type RefusedReason = 'nameTaken' | 'left' | 'keptOut' | 'handedIn' | 'notJoined';
export type Reply = { type: 'joined' } | { type: 'refused'; reason: RefusedReason };
export interface LogEvent { kind: string; at: number; details: Record<string, unknown> }
export interface Result { attempt: Attempt; events: LogEvent[]; reply?: Reply }

/** No beat for this long: no contact (in the exam), or off the list (before Start). Beats come every 2 s. */
export const NO_CONTACT_MS = 10_000;
/** Events that count as a warning on a student in the exam. Anything else (a blocked page, F-13) is a note. */
export const WARNINGS: readonly string[] = ['appClosed', 'displayAdded', 'ruleChanged'];

const JOINED: Reply = { type: 'joined' };
const same = (attempt: Attempt): Result => ({ attempt, events: [] });
const refused = (attempt: Attempt, reason: RefusedReason, events: LogEvent[] = []): Result => ({ attempt, events, reply: { type: 'refused', reason } });
const event = (kind: string, at: number, details: Record<string, unknown> = {}): LogEvent => ({ kind, at, details });
const beforeStart = (a: Attempt) => a.state === 'checking' || a.state === 'ready';
const sitting = (a: Attempt) => a.state === 'inExam' || a.state === 'noContact';

/** Join accepted: the checks start. */
function seated(a: Attempt, seat: Seat, at: number): Result {
  const attempt: Attempt = { state: 'checking', ...seat, joinedAt: at, lastBeatAt: at, extraMinutes: a.extraMinutes, warnings: 0 };
  return { attempt, events: [event('joined', at, { pc: seat.pc })], reply: JOINED };
}

/** Before Start, leaving or stopping only takes the student off the list (F-18). */
function offTheList(a: Attempt, at: number, how: LeftHow | 'noContact'): Result {
  return { attempt: { state: 'notJoined', extraMinutes: a.extraMinutes, warnings: 0 }, events: [event('leftBeforeStart', at, { how, pc: a.pc })] };
}

function leave(a: Attempt, how: LeftHow, leftAt: number, at: number, details: Record<string, unknown> = {}): Result {
  return { attempt: { ...a, state: 'left', leftAt, leftHow: how }, events: [event(how === 'pressedLeave' ? 'left' : 'stoppedSuddenly', at, details)] };
}

/** A join that is refused because the student left: it waits, and the teacher is told. */
function asks(a: Attempt, seat: Seat, at: number, events: LogEvent[]): Result {
  return refused({ ...a, asksBack: seat }, 'left', [...events, event('asksBack', at, { pc: seat.pc })]);
}

/** The teacher let them back in: in the exam on the computer they asked from. */
function comeBack(a: Attempt, seat: Seat, at: number, events: LogEvent[]): Result {
  const attempt: Attempt = { state: 'inExam', ...seat, joinedAt: a.joinedAt, lastBeatAt: at, extraMinutes: a.extraMinutes, warnings: a.warnings };
  const secondsOut = Math.round((at - (a.leftAt ?? at)) / 1000);
  return { attempt, events: [...events, event('cameBack', at, { pc: seat.pc, secondsOut })], reply: JOINED };
}

function gap(a: Attempt, at: number, localLog: unknown[], front = a.front): Result {
  const from = a.lastBeatAt ?? at;
  return {
    attempt: { ...a, state: 'inExam', lastBeatAt: at, front },
    events: [event('gap', at, { from, seconds: Math.round((at - from) / 1000), localLog })],
    reply: JOINED,
  };
}

export function onJoin(a: Attempt, seat: Seat, at: number): Result {
  switch (a.state) {
    case 'notJoined':
      return seated(a, seat, at);
    case 'handedIn':
      return refused(a, 'handedIn');
    case 'left':
      return a.mayReturn ? comeBack(a, seat, at, []) : asks(a, seat, at, []);
    default:
  }
  if (seat.instanceId === a.instanceId) return a.state === 'noContact' ? gap(a, at, []) : { attempt: a, events: [], reply: JOINED };
  // someone is at this name on another computer, and that computer is still heard from (F-02)
  if (seat.pc !== a.pc && a.state !== 'noContact') return refused(a, 'nameTaken', [event('nameTaken', at, { pc: seat.pc })]);
  // ExamMode was started again on the same computer before Start: the checks run again
  if (beforeStart(a)) return seated(a, seat, at);
  // a new ExamMode while in the exam: the old one had stopped (F-20)
  const restarted = seat.pc === a.pc && seat.bootId !== a.bootId;
  const stopped = leave(a, 'stoppedSuddenly', a.lastBeatAt ?? at, at, restarted ? { restarted } : {});
  return asks(stopped.attempt, seat, at, stopped.events);
}

/** Back after a network gap: the same ExamMode, with its own record of the gap (Q6, F-19). */
export function onResume(a: Attempt, msg: { instanceId: string; localLog: unknown[] }, at: number): Result {
  if (a.state === 'left' || a.state === 'handedIn') return refused(a, a.state);
  if (a.state === 'notJoined' || msg.instanceId !== a.instanceId) return refused(a, 'notJoined');
  if (a.state === 'noContact') return gap(a, at, msg.localLog);
  return { attempt: { ...a, lastBeatAt: at }, events: [], reply: JOINED };
}

export function onChecks(a: Attempt, results: CheckResult[], at: number): Result {
  if (a.state !== 'checking') return same(a);
  const failed = results.filter((r) => !r.ok).map((r) => event('checkFailed', at, { check: r.check }));
  return { attempt: { ...a, checks: results }, events: failed };
}

/** The checks passed and the computer is locked. A late joiner is in the exam at once (F-08). */
export function onReady(a: Attempt, at: number, run: { started: boolean }): Result {
  if (a.state !== 'checking') return same(a);
  const ready = event('ready', at);
  if (!run.started) return { attempt: { ...a, state: 'ready', lastBeatAt: at }, events: [ready] };
  return { attempt: { ...a, state: 'inExam', lastBeatAt: at }, events: [ready, event('joinedLate', at)] };
}

/** The teacher pressed Start (F-08). */
export function onStart(a: Attempt, at: number): Result {
  if (a.state !== 'ready') return same(a);
  return { attempt: { ...a, state: 'inExam', lastBeatAt: at }, events: [event('started', at)] };
}

export function onBeat(a: Attempt, beat: { front?: string }, at: number): Result {
  if (a.state === 'noContact') return { ...gap(a, at, [], beat.front), reply: undefined };
  if (!beforeStart(a) && a.state !== 'inExam') return same(a);
  return same({ ...a, lastBeatAt: at, front: beat.front });
}

/** The teacher's clock ticks: who hasn't been heard from? */
export function onTick(a: Attempt, at: number): Result {
  if (!beforeStart(a) && a.state !== 'inExam') return same(a);
  // not known after the teacher's laptop restarted (N-05): count from now
  if (a.lastBeatAt === undefined) return same({ ...a, lastBeatAt: at });
  const since = a.lastBeatAt;
  if (at - since < NO_CONTACT_MS) return same(a);
  if (beforeStart(a)) return offTheList(a, at, 'noContact');
  return { attempt: { ...a, state: 'noContact' }, events: [event('noContact', at, { since })] };
}

/** The student confirmed Leave (F-15). */
export function onLeave(a: Attempt, at: number): Result {
  if (beforeStart(a)) return offTheList(a, at, 'pressedLeave');
  if (sitting(a)) return leave(a, 'pressedLeave', at, at);
  return same(a);
}

/** The Guard saw ExamMode's process end without unlocking (F-20, Q5). */
export function onStopped(a: Attempt, msg: { instanceId: string }, at: number): Result {
  if (msg.instanceId !== a.instanceId) return same(a);
  if (beforeStart(a)) return offTheList(a, at, 'stoppedSuddenly');
  if (sitting(a)) return leave(a, 'stoppedSuddenly', a.lastBeatAt ?? at, at);
  return same(a);
}

/** The teacher's Let back in (F-40): the waiting join is accepted; without one, the next join will be. */
export function onLetBackIn(a: Attempt, msg: { reason: string }, at: number): Result {
  if (a.state !== 'left') return same(a);
  const events = [event('letBackIn', at, { reason: msg.reason })];
  return a.asksBack ? comeBack(a, a.asksBack, at, events) : { attempt: { ...a, mayReturn: true }, events };
}

/** The teacher's Keep out (F-40): the waiting join is refused. */
export function onKeepOut(a: Attempt, msg: { reason: string }, at: number): Result {
  if (a.state !== 'left') return same(a);
  const attempt: Attempt = { ...a, asksBack: undefined, mayReturn: undefined };
  const events = [event('keptOut', at, { reason: msg.reason })];
  return a.asksBack ? refused(attempt, 'keptOut', events) : { attempt, events };
}

/** Handed in: by the button, at time up, or when the teacher ended the exam (F-16, F-17, F-41). */
export function onHandIn(a: Attempt, how: HandInHow, at: number): Result {
  if (!sitting(a)) return same(a);
  return { attempt: { ...a, state: 'handedIn', handedInAt: at, handedInHow: how }, events: [event('handedIn', at, { how })] };
}

/** Something the student's computer reports: a warning in the exam if it is on the list, otherwise a note. */
export function onEvent(a: Attempt, msg: { kind: string; details: Record<string, unknown> }, at: number): Result {
  const warning = sitting(a) && WARNINGS.includes(msg.kind);
  return { attempt: warning ? { ...a, warnings: a.warnings + 1 } : a, events: [event(msg.kind, at, msg.details)] };
}

/** Extra time for this student (F-41). */
export function addTime(a: Attempt, minutes: number, at: number): Result {
  return { attempt: { ...a, extraMinutes: a.extraMinutes + minutes }, events: [event('timeAdded', at, { minutes })] };
}
