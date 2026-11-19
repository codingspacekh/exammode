/**
 * What is installed on this lab computer (F-31a, architecture §2.4): Windows' list of installed programs (the
 * uninstall keys of the registry, for the machine and for the user) and App Paths, read once with PowerShell; and
 * which of the exam profiles' apps are here. Reads only.
 */
import { access, readdir } from 'node:fs/promises';
import { LISTS } from '@domain/guard/lists';
import { BUILTIN } from '@domain/profiles/builtin';
import { installedApps, type AppPath, type Installed, type UninstallEntry } from '@domain/profiles/inventory';
import { findExe } from '@domain/profiles/find';
import { powershellJson } from './run';

const READ = `
$u = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
     'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
     'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
$entries = @(Get-ItemProperty -Path $u -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
  @{ name = [string]$_.DisplayName; publisher = [string]$_.Publisher; version = [string]$_.DisplayVersion; location = [string]$_.InstallLocation; icon = [string]$_.DisplayIcon; system = ($_.SystemComponent -eq 1) }
})
$p = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths'
$paths = @(Get-ChildItem -Path $p -ErrorAction SilentlyContinue | ForEach-Object { @{ exe = [string]$_.PSChildName; path = [string]$_.GetValue('') } })
@{ entries = $entries; paths = $paths }`;

/** Never offered for an exam: the programs ExamMode always closes. */
export const NEVER = [LISTS.browsers, LISTS.remote, LISTS.ai, LISTS.recorders].flatMap((l) => l.files);

export async function installed(): Promise<Installed | undefined> {
  const env = process.env as Record<string, string>;
  const read = await powershellJson<{ entries?: UninstallEntry[] | UninstallEntry; paths?: AppPath[] | AppPath }>(READ);
  if (!read) return undefined;
  // (PowerShell 5 writes a list of one as the one)
  const list = <T>(value: T[] | T | undefined | null): T[] => (Array.isArray(value) ? value : value ? [value] : []);
  const io = {
    env,
    exists: (path: string) => access(path).then(() => true, () => false),
    list: (folder: string) => readdir(folder).catch(() => []),
    start: async () => undefined,
  };
  const profiles: string[] = [];
  for (const profile of BUILTIN) if (await findExe(profile, io).catch(() => undefined)) profiles.push(profile.id);
  return { profiles, apps: installedApps(list(read.entries), list(read.paths), BUILTIN, env, NEVER) };
}
