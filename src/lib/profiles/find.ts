/**
 * Where an app's program is on a computer (F-11, F-31a): a profile lists its usual places; the first that is there
 * is the one. Pure: the caller says what exists (`LauncherIo`), so the launcher and the app inventory share it.
 */
import { expand, type Env } from './match';
import type { AppProfile } from './schema';

export interface LauncherIo {
  env: Env;
  exists(path: string): Promise<boolean>;
  /** the names in a folder; none if it isn't there */
  list(folder: string): Promise<string[]>;
  /** starts the program, maximised, with the Exam folder as its folder */
  start(exe: string, args: string[], folder: string): Promise<void>;
}

/** Where the profile's program is on this computer: the first of its usual places that is there. One `*` in a
 *  folder's name stands for a version (`Python3*`): the newest is taken. */
export async function findExe(profile: AppProfile, io: LauncherIo): Promise<string | undefined> {
  for (const candidate of profile.launch.exe) {
    const path = expand(candidate, io.env);
    if (path === null) continue;
    if (!path.includes('*')) {
      if (await io.exists(path)) return path;
      continue;
    }
    const parts = path.split('\\');
    const at = parts.findIndex((p) => p.includes('*'));
    const parent = parts.slice(0, at).join('\\');
    const pattern = new RegExp(`^${parts[at]!.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
    const versions = (await io.list(parent)).filter((name) => pattern.test(name)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    for (const version of versions) {
      const found = [parent, version, ...parts.slice(at + 1)].join('\\');
      if (await io.exists(found)) return found;
    }
  }
  return undefined;
}
