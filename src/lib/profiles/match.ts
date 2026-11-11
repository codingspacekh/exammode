/**
 * Recognising an app (F-12): by its publisher, file name and install folder — a renamed cheat.exe doesn't match.
 * Pure: the process's facts and the computer's environment variables are passed in.
 */
import type { AppProfile } from './schema';

/** What the process guard knows about a process (architecture §2.5). */
export interface ProcInfo {
  pid: number;
  parentPid: number;
  /** the full path; null for a protected process whose path can't be read */
  image: string | null;
  /** the publisher: the common name of a *valid* Authenticode signature */
  signer?: string;
  /** the file's ProductName, which a rename doesn't change */
  product?: string;
  hasWindow: boolean;
}

/** The environment variables of the lab computer's account: SystemRoot, ProgramFiles, LOCALAPPDATA … */
export type Env = Record<string, string>;

const norm = (path: string) => path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const fileName = (path: string): string => path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1);

/** `%ProgramFiles%\X` → `C:\Program Files\X`; null if this computer doesn't have the variable. */
export function expand(path: string, env: Env): string | null {
  let missing = false;
  const expanded = path.replace(/%([^%]+)%/g, (_, name: string) => {
    const key = Object.keys(env).find((k) => sameText(k, name));
    if (key === undefined) missing = true;
    return key === undefined ? '' : env[key]!;
  });
  return missing ? null : expanded;
}

/** Is the file inside the folder (at any depth)? */
export const under = (image: string, folder: string): boolean => norm(image).startsWith(`${norm(folder)}\\`);

/** `CN=Microsoft Windows, O=…` → `Microsoft Windows`. */
export function signerName(subject: string): string | undefined {
  const cn = /(?:^|,\s*)CN=(?:"([^"]+)"|([^,]+))/.exec(subject);
  return cn?.[1] ?? cn?.[2]?.trim();
}

export function matches(proc: ProcInfo, profile: AppProfile, env: Env): boolean {
  const { image } = proc;
  const { files, signer, paths } = profile.match;
  if (image === null || !files.some((f) => sameText(f, fileName(image)))) return false;
  if (signer !== undefined && (proc.signer === undefined || !sameText(signer, proc.signer))) return false;
  return paths.some((p) => {
    const folder = expand(p, env);
    return folder !== null && under(image, folder);
  });
}

/** An app without a profile (§1.7): recognised by its .exe (that file, in that folder) and its publisher if it has
 *  one. It is only allowed to run: nothing is turned off, and it may start nothing. */
export function customApp(image: string, signer?: string): AppProfile {
  const file = fileName(image);
  return {
    id: `app:${norm(image)}`,
    name: file.replace(/\.exe$/i, ''),
    match: { files: [file], signer, paths: [image.slice(0, image.length - file.length - 1)] },
    launch: { args: [] }, prepare: [], policies: [], children: { allow: [], never: ['browser'] }, save: 'none',
  };
}

/** The profile's arguments with the exam's folders filled in (F-11). */
export function launchArgs(profile: AppProfile, folders: { examFolder: string; examProfile: string }): string[] {
  return profile.launch.args.map((arg) => {
    const filled = arg.replace(/\{(examFolder|examProfile)\}/g, (_, name: 'examFolder' | 'examProfile') => folders[name]);
    return filled === arg ? arg : filled.replace(/\//g, '\\');
  });
}
