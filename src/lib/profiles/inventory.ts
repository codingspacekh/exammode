/**
 * The app inventory (F-31a, architecture §2.4): what a lab computer says it has installed, and what the teacher's
 * laptop makes of every computer's last report — *on 24 of 26 computers*.
 */
import { z } from 'zod';
import { isProgramPath } from './exam-apps';
import { expand, fileName, under, type Env } from './match';
import type { AppProfile } from './schema';

/** An installed app without an exam profile: it can be added to an exam by its program's place. */
export const installedApp = z.object({
  name: z.string().min(1).max(120),
  publisher: z.string().max(120).optional(),
  version: z.string().max(40).optional(),
  exe: z.string().max(300).refine(isProgramPath),
});
export type InstalledApp = z.infer<typeof installedApp>;

/** One computer's installed apps: the exam profiles it has the app for, and the other apps. */
export interface Installed { profiles: string[]; apps: InstalledApp[] }

/** An entry of Windows' list of installed programs (the uninstall keys of the registry). */
export interface UninstallEntry { name?: string | null; publisher?: string | null; version?: string | null; location?: string | null; icon?: string | null; system?: boolean | null }
/** An entry of Windows' App Paths: a program's file name and where it is. */
export interface AppPath { exe?: string | null; path?: string | null }

const NOT_AN_APP = /^(?:unins\w*|uninstall\w*|setup|install\w*|update\w*|msiexec|rundll32)\.exe$/i;
const NOT_A_NAME = /\b(?:KB\d{6,}|redistributable|runtime|driver|update for|security update|sdk|hotfix)\b/i;
const clean = (text?: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();
const unquote = (path: string): string => path.replace(/^"([^"]*)".*$/, '$1').replace(/,\s*-?\d+$/, '').trim();

/** The apps a teacher could add, from Windows' own lists: those whose program is known, and isn't part of Windows
 *  or an installer. An app that has an exam profile isn't here: `profiles` says it. Nor is a browser, a remote
 *  tool, an AI app or a recorder: the exam's browser is ExamMode's own. */
export function installedApps(entries: UninstallEntry[], paths: AppPath[], profiles: AppProfile[], env: Env, /** programs that are never an exam's app, by file name: browsers, remote tools … */ never: string[] = []): InstalledApp[] {
  const notForExams = new Set(never.map((f) => f.toLowerCase()));
  const windows = expand('%SystemRoot%', env);
  const programs = paths.flatMap((p) => (p.path ? [unquote(expand(p.path, env) ?? p.path)] : [])).filter(isProgramPath);
  const withProfile = new Set(profiles.flatMap((p) => p.match.files.map((f) => f.toLowerCase())));
  const found = new Map<string, InstalledApp>();
  for (const entry of entries) {
    const name = clean(entry.name);
    if (name === '' || entry.system || NOT_A_NAME.test(name)) continue;
    const icon = unquote(expand(clean(entry.icon), env) ?? '');
    const folder = clean(entry.location).replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
    const exe = isProgramPath(icon) ? icon : folder === '' ? undefined : programs.find((p) => under(p, folder));
    if (!exe || NOT_AN_APP.test(fileName(exe)) || withProfile.has(fileName(exe).toLowerCase()) || notForExams.has(fileName(exe).toLowerCase())) continue;
    if (windows && under(exe, windows)) continue;
    const app = installedApp.safeParse({ name: name.slice(0, 120), publisher: clean(entry.publisher).slice(0, 120) || undefined, version: clean(entry.version).slice(0, 40) || undefined, exe });
    if (app.success && !found.has(exe.toLowerCase())) found.set(exe.toLowerCase(), app.data);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_APPS);
}
export const MAX_APPS = 400;

/** An app of the lab computers, and how many of them have it. */
export interface LabApp extends InstalledApp { computers: number }
/** What Add an app shows (11b). */
export interface LabApps {
  /** how many lab computers have said what they have */
  computers: number;
  /** by exam profile: how many computers have its app */
  profiles: Record<string, number>;
  /** the apps without a profile, the most widespread first */
  others: LabApp[];
}

/** Every computer's last report, as one list. An app in another place on another computer is another row: an app
 *  without a profile is allowed by its program's place. */
export function labApps(reports: Installed[]): LabApps {
  const profiles: Record<string, number> = {};
  const others = new Map<string, LabApp>();
  for (const report of reports) {
    for (const id of new Set(report.profiles)) profiles[id] = (profiles[id] ?? 0) + 1;
    for (const key of new Set(report.apps.map((a) => a.exe.toLowerCase()))) {
      const app = report.apps.find((a) => a.exe.toLowerCase() === key)!;
      const row = others.get(key);
      if (row) row.computers++;
      else others.set(key, { ...app, computers: 1 });
    }
  }
  return { computers: reports.length, profiles, others: [...others.values()].sort((a, b) => b.computers - a.computers || a.name.localeCompare(b.name)) };
}

/** "on 24 of 26 computers"; nothing while no computer has said what it has. */
export const onComputers = (have: number | undefined, all: number): string => (all === 0 ? '' : `on ${have ?? 0} of ${all} computer${all === 1 ? '' : 's'}`);
