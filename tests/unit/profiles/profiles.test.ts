import { describe, expect, it } from 'vitest';
import { customApp, expand, fileName, launchArgs, matches, signerName, under } from '@lib/profiles/match';
import { appProfile } from '@lib/profiles/schema';
import { env, recording } from '../../fixtures/procs';
import { vscode, vscodeJson, word, wordJson } from '../../fixtures/profiles';

const lab = recording('lab-by-hand.json');
const proc = (pid: number) => lab.find((p) => p.pid === pid)!;

describe('§2.10 the profile schema', () => {
  it("the architecture's VS Code profile is valid, and kept as written", () => {
    expect(vscode).toEqual({ ...vscodeJson, launch: { ...vscodeJson.launch, exe: [] } });
  });
  it('a short profile gets the safe defaults: no arguments, no children, no browser ever', () => {
    const p = appProfile.parse({ id: 'thonny', name: 'Thonny', match: { files: ['thonny.exe'], paths: ['%LOCALAPPDATA%\\Programs\\Thonny'] } });
    expect(p).toMatchObject({ launch: { args: [] }, prepare: [], policies: [], children: { allow: [], never: ['browser'] }, save: 'none' });
    expect(word.launch.args).toEqual([]);
  });
  it('a profile must say how to recognise the app: a file name and a folder', () => {
    expect(appProfile.safeParse({ ...wordJson, match: { files: [], paths: ['%ProgramFiles%\\Microsoft Office'] } }).success).toBe(false);
    expect(appProfile.safeParse({ ...wordJson, match: { files: ['WINWORD.EXE'], paths: [] } }).success).toBe(false);
  });
  it('a launch argument may only use {examFolder} and {examProfile}', () => {
    expect(appProfile.safeParse({ ...wordJson, launch: { args: ['{examFolder}\\Report.docx'] } }).success).toBe(true);
    expect(appProfile.safeParse({ ...wordJson, launch: { args: ['{desktop}'] } }).success).toBe(false);
  });
  it('a policy is a registry value of the user or the machine', () => {
    expect(appProfile.safeParse({ ...wordJson, policies: [{ hive: 'everyone', key: 'Software\\X', name: 'Y', value: 1 }] }).success).toBe(false);
    // the journal's target is the key and the name joined by a backslash: a name can't have one
    expect(appProfile.safeParse({ ...wordJson, policies: [{ hive: 'user', key: 'Software\\X', name: 'Y\\Z', value: 1 }] }).success).toBe(false);
  });
});

describe('F-12 an app is recognised by its publisher and install path, not its name', () => {
  it('Word in Program Files, signed by Microsoft, matches Word', () => {
    expect(matches(proc(3000), word, env)).toBe(true);
  });
  it("F-12 a renamed cheat.exe doesn't match Word's profile", () => {
    expect(proc(3100).image).toBe('C:\\Users\\Student\\Downloads\\WINWORD.EXE');
    expect(matches(proc(3100), word, env)).toBe(false);
  });
  it('the right name in the right folder with the wrong publisher does not match', () => {
    expect(matches({ ...proc(3000), signer: 'Cheats Ltd' }, word, env)).toBe(false);
    expect(matches({ ...proc(3000), signer: undefined }, word, env)).toBe(false);
  });
  it('another Microsoft program in the same folder is not Word', () => {
    expect(matches({ ...proc(3000), image: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE' }, word, env)).toBe(false);
  });
  it('names and paths are matched without regard to case', () => {
    expect(matches({ ...proc(3000), image: 'c:\\program files\\microsoft office\\ROOT\\office16\\winword.exe', signer: 'microsoft corporation' }, word, env)).toBe(true);
  });
  it("VS Code installed for the user matches by %LOCALAPPDATA%; a folder that only starts the same doesn't", () => {
    expect(matches(proc(4000), vscode, env)).toBe(true);
    expect(matches({ ...proc(4000), image: 'C:\\Users\\Student\\AppData\\Local\\Programs\\Microsoft VS Code Fake\\Code.exe' }, vscode, env)).toBe(false);
  });
  it('a protected process with no path matches nothing', () => {
    expect(matches({ pid: 4, parentPid: 0, image: null, hasWindow: false }, word, env)).toBe(false);
  });
  it('a path with a variable this computer does not have matches nothing', () => {
    expect(matches(proc(3000), word, {})).toBe(false);
  });
});

describe('§1.7 an app without a profile is only allowed to run', () => {
  it('it is recognised by its .exe: that file in that folder', () => {
    const oneEditor = customApp('C:\\Program Files\\OneEditor\\OneEditor.exe');
    expect(oneEditor).toMatchObject({ id: 'app:c:\\program files\\oneeditor\\oneeditor.exe', name: 'OneEditor', policies: [], children: { allow: [], never: ['browser'] } });
    expect(matches(proc(5400), oneEditor, env)).toBe(true);
    expect(matches({ ...proc(5400), image: 'C:\\Users\\Student\\Downloads\\OneEditor.exe' }, oneEditor, env)).toBe(false);
  });
  it('and by its publisher, when it has one', () => {
    const python = customApp(proc(4030).image!, 'Python Software Foundation');
    expect(matches(proc(4030), python, env)).toBe(true);
    expect(matches({ ...proc(4030), signer: undefined }, python, env)).toBe(false);
  });
});

describe('F-11 launch arguments', () => {
  const folders = { examFolder: 'C:\\Users\\Student\\Documents\\ExamMode\\r-1\\s-07', examProfile: 'C:\\ProgramData\\ExamMode\\profiles\\vscode' };
  it('VS Code gets its own data and extensions folders, opened on the Exam folder', () => {
    expect(launchArgs(vscode, folders)).toEqual([
      '--user-data-dir', 'C:\\ProgramData\\ExamMode\\profiles\\vscode\\data',
      '--extensions-dir', 'C:\\ProgramData\\ExamMode\\profiles\\vscode\\ext',
      'C:\\Users\\Student\\Documents\\ExamMode\\r-1\\s-07',
    ]);
  });
  it('an argument without a folder in it is left alone', () => {
    const p = appProfile.parse({ ...wordJson, launch: { args: ['/q', '/t', 'a/b'] } });
    expect(launchArgs(p, folders)).toEqual(['/q', '/t', 'a/b']);
  });
});

describe('paths and publishers', () => {
  it('expands %Variables%, whatever their case', () => {
    expect(expand('%programfiles(x86)%\\Microsoft Office', env)).toBe('C:\\Program Files (x86)\\Microsoft Office');
    expect(expand('%NoSuchThing%\\x', env)).toBeNull();
    expect(expand('C:\\Plain', env)).toBe('C:\\Plain');
  });
  it('under() is true only inside the folder', () => {
    expect(under('C:\\A\\B\\c.exe', 'c:/a/')).toBe(true);
    expect(under('C:\\AB\\c.exe', 'C:\\A')).toBe(false);
    expect(under('C:\\A', 'C:\\A')).toBe(false);
  });
  it('the file name is the last part of the path', () => {
    expect(fileName('C:\\Windows\\System32\\dwm.exe')).toBe('dwm.exe');
    expect(fileName('C:/Windows/explorer.exe')).toBe('explorer.exe');
  });
  it("the publisher is the certificate subject's common name", () => {
    expect(signerName('CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US')).toBe('Microsoft Windows');
    expect(signerName('CN="Sample Software, Inc.", O="Sample Software, Inc.", C=US')).toBe('Sample Software, Inc.');
    expect(signerName('O=No Common Name')).toBeUndefined();
  });
});
