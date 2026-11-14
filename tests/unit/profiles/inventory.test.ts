import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN } from '@lib/profiles/builtin';
import { installedApps, labApps, onComputers, type AppPath, type Installed, type UninstallEntry } from '@lib/profiles/inventory';
import { env } from '../../fixtures/procs';

const pc = JSON.parse(readFileSync(join(__dirname, '../../fixtures/inventory/lab-pc.json'), 'utf8')) as { entries: UninstallEntry[]; paths: AppPath[] };

describe('F-31a what a lab computer has installed', () => {
  const apps = installedApps(pc.entries, pc.paths, BUILTIN, env);
  it('an app is listed with its name, publisher, version and its program\'s place', () => {
    expect(apps).toContainEqual({ name: 'GIMP 2.10.36', publisher: 'The GIMP Team', version: '2.10.36', exe: 'C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe' });
  });
  it('the program is read from the icon, quoted or not, or found in App Paths under the install folder', () => {
    expect(apps.find((a) => a.name.startsWith('Notepad++'))?.exe).toBe('C:\\Program Files\\Notepad++\\notepad++.exe');
    expect(apps.find((a) => a.name === 'Scratch 3')?.exe).toBe('C:\\Program Files\\Scratch 3\\Scratch 3.exe');
  });
  it('parts of Windows, installers, runtimes and entries with no program are left out', () => {
    expect(apps.map((a) => a.name)).toEqual(['GIMP 2.10.36', 'Notepad++ (64-bit x64)', 'Scratch 3']);
  });
  it('an app that has an exam profile is not listed twice: its profile says it', () => {
    expect(apps.some((a) => /thonny/i.test(a.name))).toBe(false);
  });
  it('a browser or a remote tool is never offered for an exam', () => {
    const firefox = { name: 'Mozilla Firefox (x64 en-US)', publisher: 'Mozilla', icon: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe,0' };
    expect(installedApps([firefox], [], BUILTIN, env).map((a) => a.name)).toEqual(['Mozilla Firefox (x64 en-US)']);
    expect(installedApps([firefox], [], BUILTIN, env, ['Firefox.exe'])).toEqual([]);
  });
  it('nothing installed: nothing listed', () => {
    expect(installedApps([], [], BUILTIN, env)).toEqual([]);
  });
});

describe('F-31a the lab computers\' apps, for Add an app', () => {
  const gimp = { name: 'GIMP 2.10.36', publisher: 'The GIMP Team', version: '2.10.36', exe: 'C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe' };
  const npp = { name: 'Notepad++', version: '8.6', exe: 'C:\\Program Files\\Notepad++\\notepad++.exe' };
  const reports: Installed[] = Array.from({ length: 26 }, (_, i) => ({
    profiles: i < 24 ? ['word', 'thonny'] : ['word'],
    apps: i < 12 ? [gimp, npp] : [{ ...gimp, exe: gimp.exe.toUpperCase() }],
  }));
  const lab = labApps(reports);
  it('an app on 24 of 26 computers says so', () => {
    expect(lab.computers).toBe(26);
    expect(lab.profiles).toEqual({ word: 26, thonny: 24 });
    expect(onComputers(lab.profiles.thonny, lab.computers)).toBe('on 24 of 26 computers');
    expect(onComputers(lab.profiles.vscode, lab.computers)).toBe('on 0 of 26 computers');
  });
  it('the apps without a profile: the most widespread first, the same program counted once whatever its case', () => {
    expect(lab.others.map((a) => [a.name, a.computers])).toEqual([['GIMP 2.10.36', 26], ['Notepad++', 12]]);
  });
  it('before any computer has said what it has, nothing is claimed', () => {
    expect(labApps([])).toEqual({ computers: 0, profiles: {}, others: [] });
    expect(onComputers(undefined, 0)).toBe('');
    expect(onComputers(1, 1)).toBe('on 1 of 1 computer');
  });
});
