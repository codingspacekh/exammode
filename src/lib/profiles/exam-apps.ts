/**
 * The apps of an exam (F-31, §1.7): chosen for each exam, never built in. Each is one of the profiles that come
 * with ExamMode, by its id — or any other program, by its .exe on the lab computers, which is only allowed to run.
 */
import { z } from 'zod';
import { builtin } from './builtin';
import { customApp, fileName } from './match';
import type { AppProfile } from './schema';

export const examApp = z.union([
  z.object({ profile: z.string().min(1) }),
  z.object({ custom: z.object({ image: z.string().min(1), name: z.string().min(1).optional(), signer: z.string().min(1).optional() }) }),
]);
export type ExamApp = z.infer<typeof examApp>;

/** Is this the full path of a program on a Windows computer? `C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe` */
export const isProgramPath = (path: string): boolean => /^[a-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+\.exe$/i.test(path.trim());

/** The exam's apps as profiles: what the lock allows, and what the exam bar can start. A profile this ExamMode
 *  doesn't know (a newer teacher's laptop) is left out. */
export function examProfiles(apps: ExamApp[]): AppProfile[] {
  const profiles: AppProfile[] = [];
  for (const app of apps) {
    const profile = 'profile' in app ? builtin(app.profile) : { ...customApp(app.custom.image.trim(), app.custom.signer), ...(app.custom.name ? { name: app.custom.name } : {}) };
    if (profile && !profiles.some((p) => p.id === profile.id)) profiles.push(profile);
  }
  return profiles;
}

/** An app's name for a list: the profile's, or the program's file without `.exe`. */
export function appLabel(app: ExamApp): string {
  if ('profile' in app) return builtin(app.profile)?.name ?? app.profile;
  return app.custom.name ?? fileName(app.custom.image).replace(/\.exe$/i, '');
}
