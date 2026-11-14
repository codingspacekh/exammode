/**
 * The classroom server on the teacher's laptop (architecture §2.7): HTTP and WebSocket on port 47800. It only
 * carries messages: every decision is the Classroom's (classroom.ts).
 *
 *   GET  /exams                the open runs, as the beacon announces them (F-01, for a typed-in computer name)
 *   GET  /runs/<run>/students  the class list to pick a name from (F-02)
 *   WS   /ws                   join or resume first, then the rest of the protocol
 *   GET  /runs/<run>/files/<f>  a file the teacher gives every student, with the attempt's token (F-33)
 *   POST /stopped              the Guard: ExamMode's process ended without unlocking (F-20)
 *   POST /inventory            a lab computer's installed apps, for Add an app (F-31a)
 *   POST /upload               a backup or a hand-in: `meta` first, then the files as f0, f1 … (F-16, F-22)
 */
import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { AddressInfo } from 'node:net';
import busboy from 'busboy';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, inventory, parseFromStudent, stopped, updateReply, upload, type Beacon, type FromTeacher, type Inventory, type Upload } from '@lib/protocol/messages';
import { signBeacon, signMessage, signUpload, type Identity } from '../../trust/signed';
import type { Classroom, Link } from './classroom';
import { discard, newIncoming, receive, type Received } from './handIns';

export const PORT = 47800;
const TICK_MS = 1000;
const SMALL_BODY = 16 * 1024;
const INVENTORY_BODY = 256 * 1024;

export interface ServerOptions {
  /** the Hand-ins folder: files wait in it while they are checked */
  handIns: string;
  port?: number;
  /** how often the rooms' clocks tick; 0: only when the caller ticks them */
  tickMs?: number;
  /** the teacher's licence and key: everything a lab computer must believe is signed with it (F-44). None: a
   *  development build's teacher, which only a development build's ExamMode joins */
  identity?: Identity;
  /** keeps what a lab computer says it has installed; false: it wasn't kept */
  inventory?: (report: Inventory) => Promise<boolean>;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
};

async function smallBody(req: IncomingMessage, limit = SMALL_BODY): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

export class ClassroomServer {
  private readonly rooms = new Map<string, Classroom>();
  private readonly http: Server;
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  private timer?: NodeJS.Timeout;

  constructor(private readonly options: ServerOptions) {
    this.http = createServer((req, res) => void this.answer(req, res).catch(() => json(res, 500, { error: 'failed' })));
    this.http.on('upgrade', (req, socket, head) => {
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return socket.destroy();
      this.sockets.handleUpgrade(req, socket, head, (ws) => this.connected(ws, req.socket.remoteAddress));
    });
  }

  /** The port it listens on. */
  get port(): number {
    return (this.http.address() as AddressInfo).port;
  }

  add(room: Classroom): void {
    this.rooms.set(room.id, room);
  }

  remove(runId: string): void {
    this.rooms.delete(runId);
  }

  /** The open runs, as the beacon announces them (§2.7). */
  listings(): Beacon[] {
    return [...this.rooms.values()].flatMap((room) => {
      const listing = room.listing();
      if (!listing) return [];
      const beacon: Beacon = { v: PROTOCOL_VERSION, ...listing, port: this.port, teacherKeyFp: null };
      return [this.options.identity ? signBeacon(beacon, this.options.identity) : beacon];
    });
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.options.port ?? PORT, resolve);
    });
    const every = this.options.tickMs ?? TICK_MS;
    if (every > 0) this.timer = setInterval(() => void this.tick(), every);
  }

  async tick(): Promise<void> {
    for (const room of this.rooms.values()) await room.tick();
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    for (const ws of this.sockets.clients) ws.terminate();
    this.http.closeAllConnections();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────────────────────────────────────────

  private connected(ws: WebSocket, from?: string): void {
    // each message is signed for this connection — the student's own random word — and counted (F-44)
    const identity = this.options.identity;
    let nonce: string | undefined;
    let n = 0;
    const say = (msg: FromTeacher): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(identity && nonce ? signMessage(msg, nonce, n++, identity.privateKey) : msg));
    };
    const link: Link = { send: say, close: () => ws.close(), from };
    let room: Classroom | undefined;
    ws.on('error', () => ws.terminate());
    ws.on('close', () => room?.dropped(link));
    ws.on('message', (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        return;
      }
      const asking = raw as { type?: unknown; nonce?: unknown } | null;
      if (asking && (asking.type === 'join' || asking.type === 'resume') && typeof asking.nonce === 'string') {
        nonce = asking.nonce;
        n = 0;
      }
      const parsed = parseFromStudent(raw);
      if (!parsed.ok) {
        // an ExamMode of another version: one of the two has to be updated
        if (parsed.reason !== 'invalid') {
          say(updateReply());
          ws.close();
        }
        return;
      }
      const { msg } = parsed;
      if (msg.type === 'join') room = this.rooms.get(msg.runId);
      else if (msg.type === 'resume') room = [...this.rooms.values()].find((r) => r.knows(msg.token));
      else if (!room) return;
      if (!room) {
        say({ v: PROTOCOL_VERSION, type: 'refused', reason: msg.type === 'join' ? 'ended' : 'notJoined' });
        return ws.close();
      }
      void room.receive(link, msg).catch(() => ws.close());
    });
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method === 'GET' && path === '/exams') return json(res, 200, this.listings());
    const students = /^\/runs\/([^/]+)\/students$/.exec(path);
    if (req.method === 'GET' && students) {
      const room = this.rooms.get(decodeURIComponent(students[1]!));
      return room?.listing() ? json(res, 200, { v: PROTOCOL_VERSION, students: room.names() }) : json(res, 404, { error: 'noSuchRun' });
    }
    const given = /^\/runs\/([^/]+)\/files\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && given) {
      // a file the teacher gives every student: only for one of the run's students, by their token
      const token = req.headers['x-exammode-token'];
      const file = typeof token === 'string' ? this.rooms.get(decodeURIComponent(given[1]!))?.givenFile(token, decodeURIComponent(given[2]!)) : undefined;
      if (!file) return json(res, 404, { error: 'notFound' });
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return void (await pipeline(createReadStream(file), res).catch(() => res.destroy()));
    }
    if (req.method === 'POST' && path === '/stopped') return this.stopped(req, res);
    if (req.method === 'POST' && path === '/inventory') {
      const report = inventory.safeParse(await smallBody(req, INVENTORY_BODY));
      if (!report.success || report.data.v !== PROTOCOL_VERSION) return json(res, 400, { error: 'invalid' });
      const kept = await this.options.inventory?.(report.data) ?? false;
      return json(res, kept ? 200 : 409, kept ? { v: PROTOCOL_VERSION, ok: true } : { error: 'refused' });
    }
    if (req.method === 'POST' && path === '/upload') return this.upload(req, res);
    json(res, 404, { error: 'notFound' });
  }

  private async stopped(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const msg = stopped.safeParse(await smallBody(req));
    if (!msg.success) return json(res, 400, { error: 'invalid' });
    for (const room of this.rooms.values()) if (await room.stopped(msg.data)) return json(res, 200, { v: PROTOCOL_VERSION, ok: true });
    json(res, 404, { error: 'unknown' });
  }

  /** `meta` says who sends which files; it must come first, so nothing is taken from a stranger. */
  private async upload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!req.headers['content-type']?.startsWith('multipart/form-data')) return json(res, 400, { error: 'invalid' });
    const folder = await newIncoming(this.options.handIns);
    const files: Promise<Received>[] = [];
    let meta: Upload | undefined;
    let room: Classroom | undefined;
    let refused: [number, string] | undefined;
    const refuse = (status: number, error: string): void => void (refused ??= [status, error]);

    const parts = busboy({ headers: req.headers, limits: { fieldSize: 1024 * 1024 } });
    parts.on('field', (name, value) => {
      if (name !== 'meta' || meta) return;
      let raw: unknown;
      try {
        raw = JSON.parse(value);
      } catch {
        return refuse(400, 'invalid');
      }
      const parsed = upload.safeParse(raw);
      if (!parsed.success || parsed.data.v !== PROTOCOL_VERSION) return refuse(400, 'invalid');
      meta = parsed.data;
      room = [...this.rooms.values()].find((r) => r.knows(parsed.data.token));
      if (!room) return refuse(401, 'unknown');
      if (room.mayUpload(meta) !== 'ok') refuse(409, 'refused');
    });
    parts.on('file', (field, stream) => {
      const announced = meta?.files[Number(field.slice(1))];
      if (!meta) refuse(400, 'invalid');
      if (refused || !announced || !/^f\d+$/.test(field)) return void stream.resume();
      files.push(receive(announced.name, stream, folder));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        parts.on('close', resolve).on('error', reject);
        req.on('error', reject).pipe(parts);
      });
      const received = await Promise.all(files);
      if (refused) return json(res, ...refused);
      if (!meta || !room) return json(res, 400, { error: 'invalid' });
      const result = await room.upload(meta, received);
      if (!result.ok) return json(res, { unknown: 401, refused: 409, mismatch: 422 }[result.why], { error: result.why });
      const identity = this.options.identity;
      // signed: the teacher's laptop has exactly these files of this student (F-44)
      json(res, 200, { ...(result.receipt ?? { v: PROTOCOL_VERSION, ok: true }), ...(identity ? { sig: signUpload(meta.token, meta.kind, meta.files, identity.privateKey) } : {}) });
    } catch {
      json(res, 400, { error: 'invalid' });
    } finally {
      await discard(folder);
    }
  }
}
