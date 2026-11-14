/**
 * Finding exams (F-01, architecture §2.7): the teacher's laptop announces its open runs on the classroom network
 * every 2 s, as a UDP broadcast to port 47801.
 */
import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import type { Beacon } from '@lib/protocol/messages';

export const BEACON_PORT = 47801;
export const BEACON_MS = 2000;

type Interfaces = ReturnType<typeof networkInterfaces>;

/** Where to send: the broadcast address of every network this computer is on, and the one for "here". */
export function broadcastAddresses(interfaces: Interfaces = networkInterfaces()): string[] {
  const found = new Set<string>(['255.255.255.255']);
  for (const addresses of Object.values(interfaces)) {
    for (const a of addresses ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      found.add(ip.map((part, i) => (part | (~(mask[i] ?? 255) & 255))).join('.'));
    }
  }
  return [...found];
}

export interface BeaconOptions {
  port?: number;
  everyMs?: number;
  /** where to send; by default every network's broadcast address */
  targets?: () => string[];
}

export class BeaconSender {
  private socket?: Socket;
  private timer?: NodeJS.Timeout;

  constructor(private readonly listings: () => Beacon[], private readonly options: BeaconOptions = {}) {}

  async start(): Promise<void> {
    const socket = createSocket('udp4');
    // a network that refuses a broadcast mustn't stop the others (R3)
    socket.on('error', () => undefined);
    await new Promise<void>((resolve) => socket.bind(0, resolve));
    socket.setBroadcast(true);
    this.socket = socket;
    this.timer = setInterval(() => this.announce(), this.options.everyMs ?? BEACON_MS);
    this.announce();
  }

  /** One announcement of every open run, now. */
  announce(): void {
    const targets = (this.options.targets ?? broadcastAddresses)();
    for (const listing of this.listings()) {
      const packet = Buffer.from(JSON.stringify(listing));
      for (const target of targets) this.socket?.send(packet, this.options.port ?? BEACON_PORT, target, () => undefined);
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}
