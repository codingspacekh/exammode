/**
 * The classroom server on the teacher's laptop (architecture §2.7): HTTP and WebSocket on PORTS.classroom. Its
 * routes and its errors are the contract's (src/contracts/network/http.ts); it only carries messages: every
 * decision is the Classroom's (classroom.ts).
 */
import { createReadStream } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import busboy from 'busboy';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_FILE_BYTES, MAX_FILES, PROTOCOL_VERSION, inventory, parseFromStudent, stopped, updateReply, upload, type Beacon, type FromTeacher, type Inventory, type Upload } from '@contracts/network/messages';
import { ERRORS, PORTS, TOKEN_HEADER, WS_PATH, matchRoute, type HttpError } from '@contracts/network/http';
import { connectionOf, signBeacon, signMessage, signUpload, type Identity } from '../crypto/signed';
import type { Classroom, Link } from '@application/teacher/classroom';
import { discard, incomingFolder, newIncoming, receive, type Received } from '../fs/hand-ins';

export const PORT = PORTS.classroom;
const TICK_MS = 1000;
const SMALL_BODY = 16 * 1024;
const INVENTORY_BODY = 256 * 1024;
/** How many connections at once: far more than a lab has computers. */
export const MAX_SOCKETS = 1000;
/** A connection that hasn't asked to join by then is closed. */
export const JOIN_WITHIN_MS = 10_000;
/** One file, and one request, at most; and what must stay free on the teacher's disk. */
export const MAX_REQUEST_BYTES = 1024 * 1024 * 1024;
const FREE_DISK_FLOOR = 500 * 1024 * 1024;
/** How many computers one address may report installed apps for. */
const INVENTORY_PER_ADDRESS = 60;

export interface ServerOptions {
  /** the Hand-ins folder: files wait in it while they are checked */
  handIns: string;
  port?: number;
  /** how often the rooms' clocks tick; 0: only when the caller ticks them */
  tickMs?: number;
  /** the teacher's licence and key: everything a lab computer must believe is signed with it (F-44). None: a
   *  development build's teacher, which only a development build's ExamMode joins */
  identity?: Identity;
  /** a connection that hasn't asked to join by then is closed */
  joinWithinMs?: number;
  /** what went wrong, for the log file */
  log?: (where: string, what: string, error?: unknown) => void;
  /** keeps what a lab computer says it has installed; false: it wasn't kept */
  inventory?: (report: Inventory) => Promise<boolean>;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
};
/** An error, by its name in the contract: its status and `{ error }`. */
const fail = (res: ServerResponse, error: HttpError): void => json(res, ERRORS[error], { error });

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

/** This laptop's own addresses (IPv4, as the beacon is), for the signed announcement. */
export function ownAddresses(interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const found = Object.values(interfaces).flatMap((list) => (list ?? []).filter((a) => a.family === 'IPv4').map((a) => a.address));
  return [...new Set(found)].slice(0, 16);
}

export class ClassroomServer {
  private readonly rooms = new Map<string, Classroom>();
  private readonly http: Server;
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  private timer?: NodeJS.Timeout;
  private readonly inventoried = new Map<string, Set<string>>();

  constructor(private readonly options: ServerOptions) {
    this.http = createServer((req, res) => void this.answer(req, res).catch(() => fail(res, 'failed')));
    this.http.on('upgrade', (req, socket, head) => {
      // (an address that can't be read, or too many connections: nothing a stranger sends may throw here)
      try {
        if (new URL(req.url ?? '/', 'http://x').pathname !== WS_PATH || this.sockets.clients.size >= MAX_SOCKETS) return socket.destroy();
        this.sockets.handleUpgrade(req, socket, head, (ws) => this.connected(ws, req.socket.remoteAddress));
      } catch {
        socket.destroy();
      }
    });
    // a request that never finishes doesn't hold a connection for ever
    this.http.headersTimeout = 15_000;
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
      const beacon: Beacon = { v: PROTOCOL_VERSION, ...listing, port: this.port, teacherKeyFp: null, ...(this.options.identity ? { addresses: ownAddresses() } : {}) };
      return [this.options.identity ? signBeacon(beacon, this.options.identity) : beacon];
    });
  }

  async listen(): Promise<void> {
    // files that were on their way in when the laptop last stopped: never checked, never kept
    await discard(incomingFolder(this.options.handIns)).catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.options.port ?? PORT, resolve);
    });
    const every = this.options.tickMs ?? TICK_MS;
    if (every > 0) this.timer = setInterval(() => void this.tick().catch((error: unknown) => this.options.log?.('classroom', 'the clock\'s tick failed', error)), every);
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
    const idle = setTimeout(() => ws.terminate(), this.options.joinWithinMs ?? JOIN_WITHIN_MS);
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      clearTimeout(idle);
      room?.dropped(link);
    });
    ws.on('message', (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        return;
      }
      // (a join or a return: what this connection's answers are signed for from here on)
      const asked = raw !== null && typeof raw === 'object' ? connectionOf(raw) : undefined;
      if (asked) {
        nonce = asked;
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
      if (room) clearTimeout(idle);
      if (!room) {
        say({ v: PROTOCOL_VERSION, type: 'refused', reason: msg.type === 'join' ? 'ended' : 'notJoined' });
        return ws.close();
      }
      void room.receive(link, msg).catch((error: unknown) => {
        this.options.log?.('classroom', `a ${msg.type} message failed`, error);
        ws.close();
      });
    });
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const matched = matchRoute(req.method, new URL(req.url ?? '/', 'http://x').pathname);
    switch (matched?.route) {
      case 'exams': return json(res, 200, this.listings());
      case 'students': {
        const room = this.rooms.get(matched.params.run);
        return room?.listing() ? json(res, 200, { v: PROTOCOL_VERSION, students: room.names() }) : fail(res, 'noSuchRun');
      }
      case 'given': {
        // a file the teacher gives every student: only for one of the run's students, by their token
        const token = req.headers[TOKEN_HEADER];
        const file = typeof token === 'string' ? this.rooms.get(matched.params.run)?.givenFile(token, matched.params.name) : undefined;
        if (!file) return fail(res, 'notFound');
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return void (await pipeline(createReadStream(file), res).catch(() => res.destroy()));
      }
      case 'stopped': return this.stopped(req, res);
      case 'inventory': {
        const report = inventory.safeParse(await smallBody(req, INVENTORY_BODY));
        if (!report.success || report.data.v !== PROTOCOL_VERSION) return fail(res, 'invalid');
        // (one address can't fill the list with computers that aren't there)
        const from = req.socket.remoteAddress ?? '';
        const told = this.inventoried.get(from) ?? new Set<string>();
        if (!told.has(report.data.pc) && told.size >= INVENTORY_PER_ADDRESS) return fail(res, 'refused');
        this.inventoried.set(from, told.add(report.data.pc));
        const kept = await this.options.inventory?.(report.data) ?? false;
        return kept ? json(res, 200, { v: PROTOCOL_VERSION, ok: true }) : fail(res, 'refused');
      }
      case 'upload': return this.upload(req, res);
      case undefined: return fail(res, 'notFound');
    }
  }

  private async stopped(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const msg = stopped.safeParse(await smallBody(req));
    if (!msg.success) return fail(res, 'invalid');
    for (const room of this.rooms.values()) if (await room.stopped(msg.data)) return json(res, 200, { v: PROTOCOL_VERSION, ok: true });
    // (no attempt has that token: nothing to stop — not an error the Guard should try again)
    fail(res, 'notFound');
  }

  /** `meta` says who sends which files; it must come first, so nothing is taken from a stranger. */
  private async upload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!req.headers['content-type']?.startsWith('multipart/form-data')) return fail(res, 'invalid');
    const folder = await newIncoming(this.options.handIns);
    const files: Promise<Received>[] = [];
    let meta: Upload | undefined;
    let room: Classroom | undefined;
    let refused: HttpError | undefined;
    const refuse = (error: HttpError): void => void (refused ??= error);

    // limits: the list of files in `meta`, each file, how many of them — and room left on the disk
    const parts = busboy({ headers: req.headers, limits: { fieldSize: 8 * 1024 * 1024, fields: 1, files: MAX_FILES, fileSize: MAX_FILE_BYTES } });
    parts.on('field', (name, value, info) => {
      if (name !== 'meta' || meta) return;
      if (info.valueTruncated) return refuse('tooBig');
      let raw: unknown;
      try {
        raw = JSON.parse(value);
      } catch {
        return refuse('invalid');
      }
      const parsed = upload.safeParse(raw);
      if (!parsed.success || parsed.data.v !== PROTOCOL_VERSION) return refuse('invalid');
      meta = parsed.data;
      room = [...this.rooms.values()].find((r) => r.knows(parsed.data.token));
      if (!room) return refuse('unknown');
      if (room.mayUpload(meta) !== 'ok') return refuse('refused');
      void room.heard(meta.token).catch(() => undefined);
    });
    parts.on('filesLimit', () => refuse('tooBig'));
    let bytes = 0;
    parts.on('file', (field, stream) => {
      const announced = meta?.files[Number(field.slice(1))];
      if (!meta) refuse('invalid');
      // (a part that is cut off ends with an error: it is refused, not thrown)
      stream.on('error', () => refuse('invalid'));
      stream.on('limit', () => refuse('tooBig'));
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_REQUEST_BYTES) refuse('tooBig');
      });
      if (refused || !announced || !/^f\d+$/.test(field)) return void stream.resume();
      const file = receive(announced.name, stream, folder);
      // (waited for below; one that fails before then mustn't be an error nobody heard)
      file.catch(() => undefined);
      files.push(file);
    });
    try {
      const free = await statfs(this.options.handIns).then((disk) => disk.bavail * disk.bsize, () => Infinity);
      if (free < FREE_DISK_FLOOR) {
        this.options.log?.('upload', `the disk is nearly full: ${Math.round(free / 1024 / 1024)} MB free`);
        req.resume();
        return fail(res, 'diskFull');
      }
      await pipeline(req, parts);
      const received = await Promise.all(files);
      if (refused) return fail(res, refused);
      if (!meta || !room) return fail(res, 'invalid');
      let result;
      try {
        result = await room.upload(meta, received);
      } catch (error) {
        // the laptop couldn't keep the files (a full disk, a file that is open in another program): not the
        // student's doing, and the teacher is told
        this.options.log?.('upload', 'the files couldn\'t be kept', error);
        await room.uploadFailed(meta.token, error).catch(() => undefined);
        return fail(res, 'failed');
      }
      if (!result.ok) return fail(res, result.why);
      const identity = this.options.identity;
      // signed: the teacher's laptop has exactly these files of this student (F-44)
      json(res, 200, { ...(result.receipt ?? { v: PROTOCOL_VERSION, ok: true }), ...(identity ? { sig: signUpload(meta.token, meta.kind, meta.files, identity.privateKey) } : {}) });
    } catch {
      // the request was cut off, or wasn't a form
      if (!res.headersSent) fail(res, 'invalid');
    } finally {
      await discard(folder);
    }
  }
}
