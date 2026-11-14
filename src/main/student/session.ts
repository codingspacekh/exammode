/**
 * The student's side of the classroom protocol (architecture §2.7): one WebSocket to the teacher's laptop, a beat
 * every 2 s, and — when the network goes — the same ExamMode coming back with its own record of the gap (F-19).
 * It decides nothing about the exam: the teacher's laptop does (D5).
 */
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, parseFromTeacher, type ExamInfo, type FromStudent, type FromTeacher, type RefusedReason } from '@lib/protocol/messages';
import type { CheckResult } from '@lib/session/attempt';
import { clockOffset, isTimeUp, teacherTime } from '@lib/session/time';

export type SessionState =
  /** not connected yet, or asking */
  | 'joining'
  | 'checking' | 'ready' | 'inExam'
  /** the teacher's laptop can't be reached; still locked, still counting (F-19) */
  | 'noContact'
  /** refused because the student left: waiting for the teacher's Let back in (F-18) */
  | 'waiting'
  | 'refused' | 'left' | 'handedIn' | 'closed';

export type SessionEvent =
  | { type: 'state'; state: SessionState; reason?: RefusedReason }
  /** the end is known, or has moved (Start, added time, coming back) */
  | { type: 'endsAt'; endsAt: number }
  /** the teacher's laptop says: hand in now (time up, or End the exam) */
  | { type: 'end' }
  /** this computer's own count reached the end */
  | { type: 'timeUp' };

export interface Seat { runId: string; studentId: string; code: string; pc: string; instanceId: string; bootId: string }

export interface SessionOptions extends Seat {
  host: string;
  port: number;
  beatMs?: number;
  retryMs?: number;
  /** how often this computer's count is checked against the end */
  clockMs?: number;
  now?: () => number;
  /** opens the connection; a test can stand in for the network here */
  connect?: (url: string) => WebSocket;
}

type LogEntry = { at: number; kind: string; details: Record<string, unknown> };
const JOINED: readonly SessionState[] = ['checking', 'ready', 'inExam'];
const OVER: readonly SessionState[] = ['refused', 'left', 'handedIn', 'closed'];

export class Session {
  state: SessionState = 'joining';
  reason?: RefusedReason;
  token?: string;
  /** the exam's end, on the teacher's clock */
  endsAt?: number;
  /** the exam, as the teacher's laptop described it when this ExamMode joined */
  exam?: ExamInfo;
  /** the app in front, sent with every beat */
  front?: string;

  private ws?: WebSocket;
  private offset = 0;
  private seq = 0;
  private asked = 0;
  private toldTimeUp = false;
  private localLog: LogEntry[] = [];
  private timers: NodeJS.Timeout[] = [];
  private retry?: NodeJS.Timeout;
  private readonly listeners = new Set<(e: SessionEvent) => void>();
  private answered?: (reply: 'joined' | RefusedReason | 'unreachable') => void;
  private readonly now: () => number;

  constructor(private readonly options: SessionOptions) {
    this.now = options.now ?? Date.now;
  }

  /** `http://host:port`, for the files. */
  get base(): string {
    return `http://${this.options.host}:${this.options.port}`;
  }

  get seat(): Seat {
    return this.options;
  }

  /** What to add to this computer's clock to get the teacher's. */
  get clockOffset(): number {
    return this.offset;
  }

  /** The time on the teacher's clock, as well as this computer can tell (§2.8). */
  teacherNow(): number {
    return teacherTime(this.now(), this.offset);
  }

  on(listener: (e: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Asks to join. Answers with the teacher's first reply; `left` means the join waits for the teacher (F-18). */
  join(): Promise<'joined' | RefusedReason | 'unreachable'> {
    return new Promise((resolve) => {
      this.answered = resolve;
      this.timers.push(
        setInterval(() => this.beat(), this.options.beatMs ?? 2000),
        setInterval(() => this.checkClock(), this.options.clockMs ?? 250),
      );
      this.open();
    });
  }

  checks(results: CheckResult[]): void {
    this.send({ v: PROTOCOL_VERSION, type: 'checks', results });
  }

  /** The checks passed and the computer is locked. */
  ready(): void {
    this.send({ v: PROTOCOL_VERSION, type: 'ready' });
    if (this.state === 'checking') this.become('ready');
  }

  /** Something for the teacher's log (an app was closed, a page blocked …). With no contact it is kept, and sent
   *  with the record of the gap. */
  report(kind: string, details: Record<string, unknown> = {}): void {
    if (this.connected && JOINED.includes(this.state)) this.send({ v: PROTOCOL_VERSION, type: 'event', kind, details });
    else this.localLog.push({ at: this.teacherNow(), kind, details });
  }

  /** The student confirmed Leave (F-15). */
  leave(): void {
    this.send({ v: PROTOCOL_VERSION, type: 'leave' });
    this.finish('left');
  }

  /** The teacher has the hand-in: nothing more to say. */
  handedIn(): void {
    this.finish('handedIn');
  }

  close(): void {
    this.finish('closed');
  }

  /** Cuts the connection as a pulled cable would, for tests and the simulated classroom. */
  drop(): void {
    this.ws?.terminate();
  }

  // ── inside ────────────────────────────────────────────────────────────────────────────────────────────────────

  private get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(msg: FromStudent): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  private become(state: SessionState, reason?: RefusedReason): void {
    if (state === this.state && reason === this.reason) return;
    this.state = state;
    this.reason = reason;
    this.emit({ type: 'state', state, reason });
  }

  private emit(e: SessionEvent): void {
    for (const listener of this.listeners) listener(e);
  }

  private finish(state: SessionState, reason?: RefusedReason): void {
    for (const timer of this.timers.splice(0)) clearInterval(timer);
    clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.become(state, reason);
    this.reply(reason ?? 'unreachable');
  }

  private reply(answer: 'joined' | RefusedReason | 'unreachable'): void {
    this.answered?.(answer);
    this.answered = undefined;
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = (this.options.connect ?? ((url) => new WebSocket(url)))(`ws://${this.options.host}:${this.options.port}/ws`);
    } catch {
      return this.lost();
    }
    this.ws = ws;
    ws.on('open', () => this.ask());
    ws.on('message', (data) => {
      if (ws !== this.ws) return;
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        return;
      }
      const parsed = parseFromTeacher(raw);
      if (parsed.ok) this.heard(parsed.msg);
      else if (parsed.reason !== 'invalid') this.finish('refused', 'update');
    });
    ws.on('error', () => undefined);
    ws.on('close', () => {
      if (ws === this.ws) this.lost();
    });
  }

  /** With a token: the same ExamMode, back after a gap. Without: a join. */
  private ask(): void {
    this.asked = this.now();
    const { runId, studentId, code, pc, instanceId, bootId } = this.options;
    if (this.token) this.send({ v: PROTOCOL_VERSION, type: 'resume', token: this.token, instanceId, localLog: this.localLog });
    else this.send({ v: PROTOCOL_VERSION, type: 'join', runId, studentId, code, pc, instanceId, bootId });
  }

  /** The connection is gone, or couldn't be made. */
  private lost(): void {
    this.ws = undefined;
    if (OVER.includes(this.state)) return;
    // the teacher's laptop was never reached: say so, and leave trying again to the student
    if (this.state === 'joining' && this.answered) return this.finish('closed');
    if (JOINED.includes(this.state)) {
      this.localLog.push({ at: this.teacherNow(), kind: 'contactLost', details: {} });
      this.become('noContact');
    }
    this.retry = setTimeout(() => this.open(), this.options.retryMs ?? 2000);
  }

  private heard(msg: FromTeacher): void {
    switch (msg.type) {
      case 'joined': {
        this.offset = clockOffset({ sent: this.asked, received: this.now(), teacher: msg.now });
        this.token = msg.token;
        this.exam = msg.exam ?? this.exam;
        this.localLog = [];
        this.become(msg.state);
        this.reply('joined');
        if (msg.endsAt !== undefined) this.ends(msg.endsAt);
        return;
      }
      case 'refused': {
        // refused as the ExamMode that was here before: ask as a new arrival, and that answer stands
        if (this.token) {
          this.token = undefined;
          return this.ask();
        }
        if (msg.reason !== 'left') return this.finish('refused', msg.reason);
        this.become('waiting', 'left');
        return this.reply('left');
      }
      case 'start':
        this.become('inExam');
        return this.ends(msg.endsAt);
      case 'time':
        return this.ends(msg.endsAt);
      case 'end':
        return this.emit({ type: 'end' });
      default:
    }
  }

  private ends(endsAt: number): void {
    this.endsAt = endsAt;
    this.toldTimeUp = false;
    this.emit({ type: 'endsAt', endsAt });
  }

  private beat(): void {
    if (JOINED.includes(this.state)) this.send({ v: PROTOCOL_VERSION, type: 'beat', seq: this.seq++, front: this.front });
  }

  /** This computer's own count, so the exam ends on time with no contact too (F-17, F-19). */
  private checkClock(): void {
    const counting = this.state === 'inExam' || this.state === 'noContact';
    if (!counting || this.toldTimeUp || this.endsAt === undefined || !isTimeUp(this.endsAt, this.teacherNow())) return;
    this.toldTimeUp = true;
    this.emit({ type: 'timeUp' });
  }
}
