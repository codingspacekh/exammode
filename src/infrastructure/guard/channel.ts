/**
 * How ExamMode talks to the Guard (architecture §2.4): one JSON message a line each way, over a port that only
 * this computer can reach (127.0.0.1). Not a named pipe: Node can't say who may open one, and one made by a
 * service can't be written to by an ordinary account — which the lab's may be (Q12). A caller is heard only if the
 * process at the other end of its connection is ExamMode — the Guard looks that up itself; and only who locked can
 * unlock (the secret). Messages: lock (what to lock for: the Guard makes the plan), unlock, status, watch.
 */
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { z } from 'zod';
import type { Change } from '@domain/lockdown/journal';
import { lockAsk, type LockAsk } from '@domain/lockdown/plan';
import type { Answer, Guard, Watched } from '@application/guard/guard';

/** Where the Guard listens: a port of this computer's own, or (in the tests) a socket file. */
export type Endpoint = string | { host: string; port: number };
export const GUARD: Endpoint = { host: '127.0.0.1', port: 47802 };

const id = z.int().nonnegative();
const pid = z.int().positive();
const text = z.string().min(1);
export const request = z.discriminatedUnion('type', [
  z.object({ id, pid, type: z.literal('lock'), lock: lockAsk, secret: text }),
  z.object({ id, pid, type: z.literal('unlock'), secret: text }),
  z.object({ id, pid, type: z.literal('status') }),
  z.object({ id, pid, type: z.literal('watch'), secret: text, runId: z.uuid(), token: text.max(200), instanceId: text.max(200), pc: text.max(80), teacher: z.object({ host: text.max(255), port: z.int().min(1).max(65_535) }) }),
]);
export type Request = z.infer<typeof request>;
type Ask = Request extends infer R ? (R extends Request ? Omit<R, 'id' | 'pid'> : never) : never;
type Body = Answer | { ok: true; locked: boolean; changes: number; watching?: number } | { ok: false; why: 'notExamMode' | 'invalid' };
export type Reply = { id: number } & Body;

/** Reads a stream of lines, however they were cut on the way. */
function lines(socket: Socket, each: (line: string) => void): void {
  let rest = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop() ?? '';
    for (const line of parts) if (line.trim() !== '') each(line);
  });
}

/** Who is at the other end of a connection, as the Guard itself found out — not as the caller says. */
export interface Caller { pid: number; image: string }

/** The Guard's end.
 *  `callerOf`: the process at the other end, if it is the installed ExamMode.exe (D10) — found from the connection
 *  itself; what the caller says its process is (`claimed`) is only for where the system can't tell (the tests).
 *  `planFor`: the changes for what was asked: the Guard makes the plan, a caller never hands it one. */
export function serve(guard: Guard, at: Endpoint, callerOf: (socket: Socket, claimed: number) => Caller | undefined, planFor: (ask: LockAsk, caller: Caller) => Change[]): Promise<Server> {
  const server = createServer((socket) => {
    socket.on('error', () => undefined);
    const say = (reply: Reply): void => void socket.write(`${JSON.stringify(reply)}\n`);
    lines(socket, (line) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        return say({ id: 0, ok: false, why: 'invalid' });
      }
      const parsed = request.safeParse(raw);
      const asked = z.object({ id }).safeParse(raw);
      if (!parsed.success) return say({ id: asked.success ? asked.data.id : 0, ok: false, why: 'invalid' });
      const msg = parsed.data;
      const caller = callerOf(socket, msg.pid);
      if (!caller) return say({ id: msg.id, ok: false, why: 'notExamMode' });
      void answer(guard, msg, caller, planFor).then((reply) => say({ id: msg.id, ...reply }), (error) => say({ id: msg.id, ok: false, why: 'failed', detail: String(error) }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    if (typeof at === 'string') server.listen(at, () => resolve(server));
    else server.listen(at.port, at.host, () => resolve(server));
  });
}

async function answer(guard: Guard, msg: Request, caller: Caller, planFor: (ask: LockAsk, caller: Caller) => Change[]): Promise<Body> {
  switch (msg.type) {
    case 'lock': return guard.lock(planFor(msg.lock, caller), msg.secret);
    case 'unlock': return guard.unlock(msg.secret);
    case 'status': return { ok: true, ...(await guard.status()) };
    case 'watch': {
      // (the process that is watched is the one that asked, as the Guard saw it)
      const watched: Watched = { pid: caller.pid, runId: msg.runId, token: msg.token, instanceId: msg.instanceId, pc: msg.pc, teacher: msg.teacher };
      return guard.watch(watched, msg.secret);
    }
  }
}

/** ExamMode's end: one question, one answer. Fails if the Guard isn't there. */
export class GuardClient {
  private next = 1;

  constructor(private readonly at: Endpoint = GUARD, private readonly pid: number = process.pid, private readonly timeoutMs = 30_000) {}

  ask(question: Ask): Promise<Reply> {
    const msg = { ...question, id: this.next++, pid: this.pid };
    return new Promise((resolve, reject) => {
      const socket = typeof this.at === 'string' ? createConnection(this.at) : createConnection(this.at.port, this.at.host);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('The Guard didn\'t answer'));
      }, this.timeoutMs);
      const done = (act: () => void): void => {
        clearTimeout(timer);
        socket.destroy();
        act();
      };
      socket.on('error', (error) => done(() => reject(error)));
      socket.on('connect', () => socket.write(`${JSON.stringify(msg)}\n`));
      lines(socket, (line) => done(() => {
        // (whatever answers on that port: only a reply is taken as one)
        try {
          const reply = JSON.parse(line) as Reply | null;
          if (reply === null || typeof reply !== 'object' || typeof reply.ok !== 'boolean') throw new Error('not a reply');
          resolve(reply);
        } catch {
          reject(new Error('The Guard\'s answer couldn\'t be read'));
        }
      }));
    });
  }
}
