import { readFileSync } from 'node:fs';
import { signerName, type Env, type ProcInfo } from '@lib/profiles/match';

/** A process as spikes/windows/record-fixtures.mjs records it (see README.md). */
export interface Recorded {
  pid: number; parentPid: number; name: string; image: string | null;
  signer: string | null; signature: string | null; product?: string | null; hasWindow: boolean;
}

export function recording(file: string): ProcInfo[] {
  const records = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as Recorded[];
  return records.map((r) => ({
    pid: r.pid, parentPid: r.parentPid, image: r.image, hasWindow: r.hasWindow,
    // a signer counts only when Windows says the signature is valid
    signer: r.signature === 'Valid' && r.signer ? signerName(r.signer) : undefined,
    product: r.product ?? undefined,
  }));
}

/** The environment of a lab computer's shared account. */
export const env: Env = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\Student\\AppData\\Local',
};
