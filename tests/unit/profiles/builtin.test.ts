import { describe, expect, it } from 'vitest';
import { decide } from '@lib/guard/decide';
import { LISTS } from '@lib/guard/lists';
import { BUILTIN, builtin } from '@lib/profiles/builtin';
import { matches } from '@lib/profiles/match';
import { env, recording } from '../../fixtures/procs/index';

/** The profiles that come with ExamMode (§1.7), against a lab computer's recorded processes. */
const lab = recording('./lab-by-hand.json');
const at = (image: string) => lab.find((p) => p.image === image)!;

describe('§1.7 the exam profiles of v1', () => {
  it('Word, Excel, PowerPoint, Access, Project, VS Code, Python IDLE, Thonny, OneEditor and MicroLab', () => {
    expect(BUILTIN.map((p) => p.id)).toEqual(['word', 'excel', 'powerpoint', 'access', 'project', 'vscode', 'idle', 'thonny', 'oneeditor', 'microlab']);
    expect(builtin('excel')?.name).toBe('Excel');
    expect(builtin('paint')).toBeUndefined();
  });

  it('each says how it is found, started and shown: a program file, where it usually is, a badge for the exam bar', () => {
    for (const p of BUILTIN) {
      expect(p.launch.exe.length, p.id).toBeGreaterThan(0);
      expect(p.badge, p.id).toBeDefined();
      expect(p.publisher, p.id).toBeDefined();
      // where it is started from is somewhere it is recognised
      for (const exe of p.launch.exe) expect(p.match.paths.some((folder) => exe.toLowerCase().startsWith(folder.toLowerCase())), `${p.id}: ${exe}`).toBe(true);
      expect(p.children.never).toEqual(['browser']);
    }
  });

  it('F-12 a lab computer\'s Word, VS Code, Python and OneEditor are recognised; a renamed cheat isn\'t', () => {
    expect(matches(at('C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE'), builtin('word')!, env)).toBe(true);
    expect(matches(at('C:\\Users\\Student\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'), builtin('vscode')!, env)).toBe(true);
    expect(matches(at('C:\\Users\\Student\\AppData\\Local\\Programs\\Python\\Python313\\python.exe'), builtin('idle')!, env)).toBe(true);
    expect(matches(at('C:\\Program Files\\OneEditor\\OneEditor.exe'), builtin('oneeditor')!, env)).toBe(true);
    expect(matches(at('C:\\Users\\Student\\Downloads\\WINWORD.EXE'), builtin('word')!, env)).toBe(false);
    // a browser renamed python.exe, in the Exam folder: not Python's publisher, not Python's folder
    expect(matches(at('C:\\Users\\Student\\Documents\\ExamMode\\r-1\\s-07\\python.exe'), builtin('idle')!, env)).toBe(false);
  });

  it('an exam with every profile lets its apps stay and still closes the rest', () => {
    const ctx = { allowed: BUILTIN, ancestors: [], always: LISTS, env, self: ['C:\\Program Files\\ExamMode\\ExamMode.exe'] };
    const verdict = (image: string) => decide(at(image), ctx);
    expect(verdict('C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE')).toMatchObject({ allow: true, profile: 'word' });
    expect(verdict('C:\\Program Files\\OneEditor\\OneEditor.exe')).toMatchObject({ allow: true, profile: 'oneeditor' });
    expect(verdict('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toMatchObject({ allow: false, kind: 'browser' });
    expect(verdict('C:\\Windows\\System32\\notepad.exe')).toMatchObject({ allow: false });
    expect(verdict('C:\\Users\\Student\\Downloads\\WINWORD.EXE')).toMatchObject({ allow: false });
  });

  it('Office\'s own ways out are turned off for the exam, under the student\'s policies', () => {
    for (const id of ['word', 'excel', 'powerpoint', 'access', 'project']) {
      const p = builtin(id)!;
      expect(p.policies.every((policy) => policy.hive === 'user' && policy.key.startsWith('Software\\Policies\\Microsoft\\Office\\16.0\\')), id).toBe(true);
      expect(p.policies.map((policy) => policy.name)).toEqual(expect.arrayContaining(['DisconnectedState', 'SignInOptions', 'UseOnlineContent', 'DisableAllAddins']));
      expect(p.save).toBe('office');
    }
    expect(builtin('vscode')!.children.allow).toEqual(expect.arrayContaining(['python.exe', 'cmd.exe']));
  });
});
