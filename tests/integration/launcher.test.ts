import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtin } from '@lib/profiles/builtin';
import { customApp } from '@lib/profiles/match';
import { findExe, launch, type LauncherIo } from '../../src/main/student/launcher';
import { tempFolder } from './helpers';

/** A lab computer's disk, as far as the launcher looks at it. */
function computer(files: string[], home = 'C:\\Users\\Student') {
  const started: { exe: string; args: string[]; folder: string }[] = [];
  const io: LauncherIo = {
    env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: `${home}\\AppData\\Local`, USERPROFILE: home },
    exists: async (path) => files.some((f) => f.toLowerCase() === path.toLowerCase()),
    list: async (folder) => [...new Set(files.filter((f) => f.toLowerCase().startsWith(`${folder.toLowerCase()}\\`)).map((f) => f.slice(folder.length + 1).split('\\')[0]!))],
    start: async (exe, args, folder) => void started.push({ exe, args, folder }),
  };
  return { io, started };
}

describe('F-11 starting one of the exam\'s apps', () => {
  const WORD = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE';

  it('the program is found where it usually is on this computer; the likeliest place first', async () => {
    expect(await findExe(builtin('word')!, computer([WORD]).io)).toBe(WORD);
    const older = 'C:\\Program Files (x86)\\Microsoft Office\\Office16\\WINWORD.EXE';
    expect(await findExe(builtin('word')!, computer([older]).io)).toBe(older);
    expect(await findExe(builtin('word')!, computer([]).io)).toBeUndefined();
    // a computer without a variable the profile names simply doesn't have that place
    const { io } = computer([WORD]);
    expect(await findExe(builtin('vscode')!, { ...io, env: {} })).toBeUndefined();
  });

  it('a `*` stands for a version in a folder\'s name: the newest Python is taken', async () => {
    const pythons = ['39', '312', '313'].map((v) => `C:\\Users\\Student\\AppData\\Local\\Programs\\Python\\Python${v}\\pythonw.exe`);
    expect(await findExe(builtin('idle')!, computer([...pythons, 'C:\\Users\\Student\\AppData\\Local\\Programs\\Python\\Launcher\\py.exe']).io)).toBe(pythons[2]);
    // a folder that matches but has no program in it is passed over
    expect(await findExe(builtin('idle')!, computer([pythons[0]!, 'C:\\Users\\Student\\AppData\\Local\\Programs\\Python\\Python314\\README.txt']).io)).toBe(pythons[0]);
  });

  it('it is started in the Exam folder with its profile\'s arguments', async () => {
    const root = await tempFolder();
    const { io, started } = computer([WORD]);
    expect(await launch(builtin('word')!, { examFolder: 'C:\\Exam\\Sokha', examProfile: join(root, 'word') }, io)).toBeUndefined();
    expect(started).toEqual([{ exe: WORD, args: [], folder: 'C:\\Exam\\Sokha' }]);
  });

  it('an app that isn\'t on this computer, or can\'t be started, says so', async () => {
    const root = await tempFolder();
    const folders = { examFolder: 'C:\\Exam\\Sokha', examProfile: join(root, 'x') };
    expect(await launch(builtin('excel')!, folders, computer([]).io)).toBe('notInstalled');
    const { io } = computer([WORD]);
    expect(await launch(builtin('word')!, folders, { ...io, start: async () => { throw new Error('no'); } })).toBe('failed');
  });

  it('VS Code gets an exam profile of its own: its settings, and only the allowed extensions of the student\'s', async () => {
    const root = await tempFolder();
    const home = join(root, 'home');
    for (const ext of ['ms-python.python-2025.1.0', 'ms-python.debugpy-2025.0.1', 'github.copilot-1.250.0', 'ms-vsliveshare.vsliveshare-1.0.5']) {
      await mkdir(join(home, '.vscode', 'extensions', ext), { recursive: true });
      await writeFile(join(home, '.vscode', 'extensions', ext, 'package.json'), '{}');
    }
    const code = 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
    const { io, started } = computer([code], home);
    const examProfile = join(root, 'profile');
    expect(await launch(builtin('vscode')!, { examFolder: 'C:\\Exam\\Sokha', examProfile }, io)).toBeUndefined();

    const settings = JSON.parse(readFileSync(join(examProfile, 'data', 'User', 'settings.json'), 'utf8')) as Record<string, unknown>;
    expect(settings).toMatchObject({ 'chat.disableAIFeatures': true, 'extensions.autoUpdate': false, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none' });
    expect(existsSync(join(examProfile, 'ext', 'ms-python.python-2025.1.0', 'package.json'))).toBe(true);
    expect(existsSync(join(examProfile, 'ext', 'ms-python.debugpy-2025.0.1'))).toBe(true);
    expect(existsSync(join(examProfile, 'ext', 'github.copilot-1.250.0'))).toBe(false);
    expect(existsSync(join(examProfile, 'ext', 'ms-vsliveshare.vsliveshare-1.0.5'))).toBe(false);
    // it opens the Exam folder, with its own data and extensions folders
    expect(started[0]!.exe).toBe(code);
    expect(started[0]!.args.slice(0, 4)).toEqual(['--user-data-dir', `${examProfile.replaceAll('/', '\\')}\\data`, '--extensions-dir', `${examProfile.replaceAll('/', '\\')}\\ext`]);
    expect(started[0]!.args.at(-1)).toBe('C:\\Exam\\Sokha');
    // a student with no VS Code extensions at all still gets VS Code
    expect(await launch(builtin('vscode')!, { examFolder: 'C:\\Exam\\Dara', examProfile: join(root, 'p2') }, computer([code], join(root, 'nobody')).io)).toBeUndefined();
  });

  it('an app without a profile is started from where the teacher said it is', async () => {
    const gimp = 'C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe';
    const { io, started } = computer([gimp]);
    expect(await launch(customApp(gimp), { examFolder: 'C:\\Exam\\Sokha', examProfile: join(await tempFolder(), 'gimp') }, io)).toBeUndefined();
    expect(started[0]).toMatchObject({ exe: gimp, args: [] });
  });
});
