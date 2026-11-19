/**
 * Registry values, as the lockdown's journal names them: `HKLM\\SOFTWARE\\…\\Name` or `HKU\\<SID>\\…\\Name` — the
 * key, then the value's name. A number is a DWORD, text is a string; null means the value doesn't exist.
 */
import { run } from './run';

function split(target: string): { key: string; name: string } {
  const at = target.lastIndexOf('\\');
  if (at <= 0) throw new Error(`Not a registry value: ${target}`);
  return { key: target.slice(0, at), name: target.slice(at + 1) };
}

export async function readValue(target: string): Promise<number | string | null> {
  const { key, name } = split(target);
  const asked = await run('reg.exe', ['query', key, '/v', name]);
  if (!asked.ok) return null;
  // `    Name    REG_DWORD    0x1` — the name may have spaces, so the line is read from its type
  const line = asked.out.split(/\r?\n/).map((l) => /^\s+.*?\s+(REG_[A-Z_]+)(?:\s+(.*))?$/.exec(l)).find(Boolean);
  if (!line) return null;
  const [, type, value = ''] = line;
  if (type === 'REG_DWORD' || type === 'REG_QWORD') return Number.parseInt(value, 16);
  return value;
}

/** Sets a value; null deletes it. Deleting a value that isn't there is nothing. */
export async function writeValue(target: string, value: number | string | null): Promise<void> {
  const { key, name } = split(target);
  if (value === null) {
    if ((await readValue(target)) === null) return;
    const gone = await run('reg.exe', ['delete', key, '/v', name, '/f']);
    if (!gone.ok) throw new Error(`reg delete ${target}: ${gone.err || gone.out}`);
    return;
  }
  const args = typeof value === 'number' ? ['/t', 'REG_DWORD', '/d', String(value)] : ['/t', 'REG_SZ', '/d', value];
  const set = await run('reg.exe', ['add', key, '/v', name, ...args, '/f']);
  if (!set.ok) throw new Error(`reg add ${target}: ${set.err || set.out}`);
}
