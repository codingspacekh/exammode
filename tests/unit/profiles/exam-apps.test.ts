import { describe, expect, it } from 'vitest';
import { appLabel, examProfiles, isProgramPath } from '@lib/profiles/exam-apps';

describe('F-31 the apps of an exam', () => {
  it('a profile by its id, or any other program by its .exe: that one is only allowed to run', () => {
    const profiles = examProfiles([{ profile: 'word' }, { custom: { image: 'C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe', signer: 'GIMP Team' } }]);
    expect(profiles.map((p) => p.name)).toEqual(['Word', 'gimp-2.10']);
    expect(profiles[1]).toMatchObject({
      match: { files: ['gimp-2.10.exe'], signer: 'GIMP Team', paths: ['C:\\Program Files\\GIMP 2\\bin'] },
      launch: { exe: ['C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe'] }, policies: [], children: { allow: [] },
    });
  });

  it('a name can be given to it; an app chosen twice counts once; a profile this ExamMode doesn\'t know is left out', () => {
    const scratch = { custom: { image: ' C:\\Program Files\\Scratch 3\\Scratch 3.exe ', name: 'Scratch 3' } };
    expect(examProfiles([scratch, { profile: 'excel' }, scratch, { profile: 'excel' }, { profile: 'from-the-future' }]).map((p) => p.name)).toEqual(['Scratch 3', 'Excel']);
    expect(examProfiles([])).toEqual([]);
  });

  it('an app is called by its profile\'s name, the name it was given, or its file', () => {
    expect(appLabel({ profile: 'vscode' })).toBe('VS Code');
    expect(appLabel({ profile: 'from-the-future' })).toBe('from-the-future');
    expect(appLabel({ custom: { image: 'C:\\x\\gimp-2.10.exe' } })).toBe('gimp-2.10');
    expect(appLabel({ custom: { image: 'C:\\x\\gimp-2.10.exe', name: 'GIMP' } })).toBe('GIMP');
  });

  it('a program is given by its full path on the lab computers', () => {
    for (const path of ['C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe', 'd:\\Tools\\scratch.EXE', ' C:\\a.exe ']) expect(isProgramPath(path), path).toBe(true);
    for (const path of ['gimp.exe', 'C:\\Program Files\\GIMP', '/Applications/GIMP.app', 'C:\\a\\b?.exe', '\\\\server\\share\\x.exe', '']) expect(isProgramPath(path), path).toBe(false);
  });
});
