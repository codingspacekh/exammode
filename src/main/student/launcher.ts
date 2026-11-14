/**
 * Starting one of the exam's apps (F-11, architecture §2.10): where its program is on this computer, what is made
 * ready first (VS Code's own exam profile: its settings, only the allowed extensions), and how it is started —
 * in the Exam folder, maximised under the bar. What touches the computer is passed in, so the rules are tested
 * anywhere.
 */
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchArgs, type Env } from '@lib/profiles/match';
import type { AppProfile } from '@lib/profiles/schema';
import { findExe, type LauncherIo } from '@lib/profiles/find';

export { findExe, type LauncherIo };

export interface Folders { examFolder: string; /** this app's own settings for the exam, outside the Exam folder */ examProfile: string }


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
