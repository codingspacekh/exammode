/**
 * Finding exams from a lab computer (F-01, architecture §2.7): listen for the teachers' announcements and list what
 * is heard. If the network doesn't carry them (R3), the teacher's computer name can be typed in: `examsAt` asks
 * that computer directly.
 */
import { createSocket, type Socket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { PROTOCOL_VERSION, beacon, type Beacon } from '@contracts/network/messages';
import type { Trust } from '@domain/trust/licence';
import { teacherOf } from '../crypto/signed';

/** An open exam, and the computer it is on. */
export interface Found extends Beacon { host: string; heardAt: number; /** the licensed teacher's key, which this exam's messages must be signed with (F-44); none: a development build's teacher */ teacherKey?: string }

/** A development build's trust: any teacher, licensed or not. */
export const ANYONE: Trust = { authorKeys: [], allowUnsigned: true };

/** An announcement as an exam to list — only a licensed teacher's (F-44). */
export function listed(b: Beacon, trust: Trust, host: string, heardAt: number): Found | undefined {
  const key = teacherOf(b, trust, host);
  return key === undefined ? undefined : { ...b, host, heardAt, ...(key ? { teacherKey: key } : {}) };
}
export interface Name { id: string; name: string; email?: string }

/** An exam not heard of for this long is taken off the list: its beacon comes every 2 s. */
export const STALE_MS = 6000;

export interface DiscoveryOptions {
  port?: number;
  staleMs?: number;
  /** whose exams are listed; by default anyone's (a development build) */
  trust?: Trust;
  now?: () => number;
}

export class Discovery {
  private readonly heard = new Map<string, Found>();
  private readonly listeners = new Set<(found: Found[]) => void>();
  private socket?: Socket;
  private timer?: NodeJS.Timeout;
  private listed = '';
  private readonly now: () => number;

  constructor(private readonly options: DiscoveryOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /** The port it listens on. */
  get port(): number {
    return this.socket!.address().port;
  }

  async start(): Promise<void> {
    // more than one ExamMode can listen on a computer (a teacher trying it out as a student)
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (packet, from) => {
      let raw: unknown;
      try {
        raw = JSON.parse(packet.toString('utf8'));
      } catch {
        return;
      }
      const parsed = beacon.safeParse(raw);
      if (!parsed.success || parsed.data.v !== PROTOCOL_VERSION) return;
      const exam = listed(parsed.data, this.options.trust ?? ANYONE, from.address, this.now());
      if (!exam) return;
      this.heard.set(exam.runId, exam);
      this.tell();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(this.options.port ?? 47801, resolve);
    });
    this.socket = socket;
    this.timer = setInterval(() => this.tell(), 1000);
  }

  /** The exams that are open now, by title. */
  found(): Found[] {
    const since = this.now() - (this.options.staleMs ?? STALE_MS);
    for (const [runId, exam] of this.heard) if (exam.heardAt < since) this.heard.delete(runId);
    return [...this.heard.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Told when an exam appears, changes or is gone. */
  onChange(listener: (found: Found[]) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) await new Promise<void>((resolve) => socket.close(() => resolve()));
  }

  private tell(): void {
    const found = this.found();
    const listed = JSON.stringify(found.map((f) => ({ ...f, heardAt: 0 })));
    if (listed === this.listed) return;
    this.listed = listed;
    for (const listener of this.listeners) listener(found);
  }
}

/** The exams open on a computer whose name or address was typed in (F-01's fallback). None if it can't be reached. */
export async function examsAt(host: string, port = 47800, now: () => number = Date.now, get: typeof fetch = fetch, trust: Trust = ANYONE): Promise<Found[]> {
  try {
    // the name is looked up first: an announcement counts only when it comes from one of the addresses in it
    const address = await lookup(host, { family: 4 }).then((found) => found.address, () => host);
    const res = await get(`http://${address}:${port}/exams`, { signal: AbortSignal.timeout(3000) });
    const exams = z.array(beacon).safeParse(await res.json());
    return exams.success ? exams.data.filter((e) => e.v === PROTOCOL_VERSION).flatMap((e) => listed(e, trust, address, now()) ?? []) : [];
  } catch {
    return [];
  }
}

const classList = z.object({ students: z.array(z.object({ id: z.string(), name: z.string(), email: z.string().optional() })) });

/** The class list of an exam, to pick a name from (F-02). */
export async function namesOf(exam: { host: string; port: number; runId: string }, get: typeof fetch = fetch): Promise<Name[]> {
  const res = await get(`http://${exam.host}:${exam.port}/runs/${encodeURIComponent(exam.runId)}/students`, { signal: AbortSignal.timeout(3000) });
  return res.ok ? classList.parse(await res.json()).students : [];
}
