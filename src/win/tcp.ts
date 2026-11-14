/**
 * Whose connection is this? (architecture §2.4.) The Guard listens on 127.0.0.1, where any program on the computer
 * can connect and say it is ExamMode. Windows knows which process owns each connection: the Guard asks it, and
 * believes that. (`GetExtendedTcpTable`, through koffi.)
 */
import type * as Koffi from 'koffi';

let read: ((buffer: Buffer, size: number[]) => number) | undefined;

async function table(): Promise<Buffer | undefined> {
  if (!read) {
    const koffi: typeof Koffi.default = (await import('koffi')).default;
    const iphlpapi = koffi.load('iphlpapi.dll');
    const GetExtendedTcpTable = iphlpapi.func('uint32 __stdcall GetExtendedTcpTable(_Out_ void *table, _Inout_ uint32 *size, bool order, uint32 family, int kind, uint32 reserved)');
    const AF_INET = 2;
    const TCP_TABLE_OWNER_PID_ALL = 5;
    read = (buffer, size) => GetExtendedTcpTable(buffer, size, false, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0) as number;
  }
  // (the table can grow between asking how big it is and reading it: a few tries)
  let bytes = 64 * 1024;
  for (let attempt = 0; attempt < 4; attempt++) {
    const buffer = Buffer.alloc(bytes);
    const size = [bytes];
    const result = read(buffer, size);
    if (result === 0) return buffer;
    const ERROR_INSUFFICIENT_BUFFER = 122;
    if (result !== ERROR_INSUFFICIENT_BUFFER) return undefined;
    bytes = size[0]! + 16 * 1024;
  }
  return undefined;
}

/** A port as Windows keeps it in the table: its two bytes the other way round, in a 32-bit field. */
const portOf = (field: number): number => ((field & 0xff) << 8) | ((field >> 8) & 0xff);

/** The rows of the table: each connection's own port, the port at its other end, and its process. Exported for
 *  its test. */
export function rows(buffer: Buffer): { localPort: number; remotePort: number; localAddress: number; pid: number }[] {
  const count = buffer.readUInt32LE(0);
  const found = [];
  // MIB_TCPROW_OWNER_PID: state, local address, local port, remote address, remote port, owning process — six DWORDs
  for (let i = 0, at = 4; i < count && at + 24 <= buffer.length; i++, at += 24) {
    found.push({ localAddress: buffer.readUInt32LE(at + 4), localPort: portOf(buffer.readUInt32LE(at + 8)), remotePort: portOf(buffer.readUInt32LE(at + 16)), pid: buffer.readUInt32LE(at + 20) });
  }
  return found;
}

/** The process that owns the connection from `port` on this computer (127.0.0.1) to `toPort`. Nothing if Windows
 *  doesn't say. */
export async function ownerOfConnection(port: number, toPort: number): Promise<number | undefined> {
  const buffer = await table();
  if (!buffer) return undefined;
  const LOOPBACK = 0x0100007f;
  return rows(buffer).find((r) => r.localPort === port && r.remotePort === toPort && r.localAddress === LOOPBACK)?.pid;
}
