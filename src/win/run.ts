/**
 * Running Windows' own tools (reg, netsh, taskkill, PowerShell) from Node, with what M0's spike learned built in
 * (docs/acceptance/M0.md, finding 0).
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Ran { ok: boolean; code: number; out: string; err: string }

/** Runs a program and answers with what it printed. It never throws: `ok` says whether it exited with 0. */
export function run(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 2 ** 20, timeout: options.timeoutMs ?? 60_000, env: options.env }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ ok: !error, code, out: String(stdout).trim(), err: String(stderr).trim() });
    });
  });
}

/** Windows PowerShell 5. Started without PSModulePath: one set by PowerShell 7 stops it loading its own modules. */
export function powershell(command: string): Promise<Ran> {
  // (a copy of the environment is an ordinary object: the variable's name has to be found whatever its case)
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { env, timeoutMs: 120_000 });
}

/** PowerShell's answer as JSON — through a file, as Windows PowerShell 5 can break long piped lines; and judged by
 *  the file, not the exit code, which is 1 after an error that was told to be quiet. Null: nothing came. */
export async function powershellJson<T>(command: string): Promise<T | null> {
  const file = join(tmpdir(), `exammode-${process.pid}-${Date.now()}-${Math.round(Math.random() * 1e9)}.json`);
  try {
    await powershell(`${command} | ConvertTo-Json -Depth 4 -Compress | Set-Content -Encoding UTF8 -LiteralPath '${file}'; exit 0`);
    if (!existsSync(file)) return null;
    let text = await readFile(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // (it also leaves control characters, found in some apps' names, unescaped)
    text = text.replace(/\p{Cc}+/gu, ' ').trim();
    return text === '' ? null : JSON.parse(text) as T;
  } finally {
    await rm(file, { force: true });
  }
}

/** `%SystemRoot%\\System32\\x.exe` with this process's environment. */
export const expandEnv = (path: string): string => path.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? whole);
