/**
 * Starting one of the exam's apps (F-11, architecture §2.10): where its program is on this computer, what is made
 * ready first (VS Code's own exam profile: its settings, only the allowed extensions), and how it is started —
 * in the Exam folder, maximised under the bar. What touches the computer is passed in, so the rules are tested
 * anywhere.
 */
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expand, launchArgs, type Env } from '@lib/profiles/match';
import type { AppProfile } from '@lib/profiles/schema';

export interface LauncherIo {
  env: Env;
  exists(path: string): Promise<boolean>;
  /** the names in a folder; none if it isn't there */
  list(folder: string): Promise<string[]>;
  /** starts the program, maximised, with the Exam folder as its folder */
  start(exe: string, args: string[], folder: string): Promise<void>;
}

export interface Folders { examFolder: string; /** this app's own settings for the exam, outside the Exam folder */ examProfile: string }

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

/** The profile's steps before its app starts. `settings`: the app's own settings file for the exam. `copyExtensions`:
 *  only these of the student's VS Code extensions go into the exam's VS Code. */
export async function prepare(profile: AppProfile, folders: Folders, env: Env): Promise<void> {
  for (const step of profile.prepare) {
    if (step.settings && typeof step.settings === 'object') {
      const user = join(folders.examProfile, 'data', 'User');
      await mkdir(user, { recursive: true });
      await writeFile(join(user, 'settings.json'), JSON.stringify(step.settings, null, 2));
    }
    if (Array.isArray(step.copyExtensions)) {
      const home = env.USERPROFILE ?? env.HOME;
      const to = join(folders.examProfile, 'ext');
      await mkdir(to, { recursive: true });
      if (!home) continue;
      const installed = join(home, '.vscode', 'extensions');
      for (const name of await readdir(installed).catch(() => [])) {
        const wanted = (step.copyExtensions as unknown[]).some((id) => typeof id === 'string' && name.toLowerCase().startsWith(`${id.toLowerCase()}-`));
        if (wanted) await cp(join(installed, name), join(to, name), { recursive: true, force: false, errorOnExist: false }).catch(() => undefined);
      }
    }
  }
}

/** Starts the app. Answers with what went wrong, if it couldn't be. */
export async function launch(profile: AppProfile, folders: Folders, io: LauncherIo): Promise<'notInstalled' | 'failed' | undefined> {
  const exe = await findExe(profile, io);
  if (!exe) return 'notInstalled';
  try {
    await mkdir(folders.examProfile, { recursive: true });
    await prepare(profile, folders, io.env);
    await io.start(exe, launchArgs(profile, folders), folders.examFolder);
    return undefined;
  } catch {
    return 'failed';
  }
}
