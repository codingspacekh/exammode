import { describe, expect, it } from 'vitest';
import { ancestorsOf, decide, type GuardContext } from '@lib/guard/decide';
import { LISTS } from '@lib/guard/lists';
import { customApp, fileName, type ProcInfo } from '@lib/profiles/match';
import { env, recording } from '../../fixtures/procs';
import { vscode, word } from '../../fixtures/profiles';

const lab = recording('lab-by-hand.json');
const proc = (pid: number) => lab.find((p) => p.pid === pid)!;
const self = ['C:\\Program Files\\ExamMode\\ExamMode.exe', 'C:\\Program Files\\ExamMode\\ExamModeGuard.exe'];
const ctx = (allowed = [word, vscode]): Omit<GuardContext, 'ancestors'> => ({ allowed, always: LISTS, env, self });
const verdict = (p: ProcInfo, all = lab, allowed = [word, vscode]) => decide(p, { ...ctx(allowed), ancestors: ancestorsOf(p, all) });

/** The five rules of architecture §2.5, in order. */
describe('F-12 rule 1: Windows\' own processes', () => {
  it('dwm.exe in %SystemRoot%, signed by Microsoft Windows, is allowed', () => {
    expect(verdict(proc(900))).toEqual({ allow: true, why: 'system' });
  });
  it('a dwm.exe from Downloads is not Windows\' own: closed', () => {
    expect(verdict(proc(5500))).toEqual({ allow: false, why: 'notAllowed', kind: 'app' });
  });
  it('a system file name in %SystemRoot% without Windows\' signature is closed', () => {
    expect(verdict({ ...proc(900), signer: 'Microsoft Corporation', hasWindow: true }).allow).toBe(false);
  });
  it('the input method\'s windows, in their own folders, are allowed', () => {
    const ime = { ...proc(900), image: 'C:\\Windows\\System32\\InputMethod\\CHS\\ChsIME.exe', hasWindow: true };
    expect(verdict(ime)).toEqual({ allow: true, why: 'system' });
  });
  it('Windows\' own apps that are a way out — Settings, Notepad, Explorer, Search — are closed', () => {
    expect(verdict(proc(5200))).toEqual({ allow: false, why: 'notAllowed', kind: 'app' });
    expect(verdict(proc(4060), lab, [word]).allow).toBe(false);
    for (const image of ['C:\\Windows\\explorer.exe', 'C:\\Windows\\SystemApps\\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\\SearchHost.exe', 'C:\\Windows\\System32\\Taskmgr.exe', 'C:\\Windows\\System32\\cmd.exe']) {
      expect(verdict({ ...proc(900), image, hasWindow: true }).allow).toBe(false);
    }
  });
});

describe('F-12 rule 2: ExamMode itself', () => {
  it('the installed ExamMode and its own processes are allowed', () => {
    expect(verdict(proc(2000))).toEqual({ allow: true, why: 'examMode' });
    expect(verdict(proc(2010))).toEqual({ allow: true, why: 'examMode' });
    expect(verdict({ ...proc(2000), image: 'c:\\program files\\exammode\\exammodeguard.exe' }).allow).toBe(true);
  });
  it('D10 a copy of ExamMode.exe somewhere else is not ExamMode', () => {
    expect(verdict({ ...proc(2000), image: 'C:\\Users\\Student\\Downloads\\ExamMode.exe' }).allow).toBe(false);
  });
});

describe('F-12 rule 3: an allowed app', () => {
  it('Word is allowed when the exam has Word', () => {
    expect(verdict(proc(3000))).toEqual({ allow: true, why: 'profile', profile: 'word' });
  });
  it('Word is closed when the exam does not have it', () => {
    expect(verdict(proc(3000), lab, [vscode])).toEqual({ allow: false, why: 'notAllowed', kind: 'app' });
  });
  it("F-12 a renamed cheat.exe doesn't match Word's profile: closed", () => {
    expect(verdict(proc(3100))).toEqual({ allow: false, why: 'notAllowed', kind: 'app' });
  });
  it('§1.7 an app the teacher added without a profile is allowed to run', () => {
    expect(verdict(proc(5400)).allow).toBe(false);
    const oneEditor = customApp(proc(5400).image!);
    expect(verdict(proc(5400), lab, [word, oneEditor])).toEqual({ allow: true, why: 'profile', profile: oneEditor.id });
  });
  it('a browser the teacher added as an app is allowed (it still cannot reach the internet, F-23)', () => {
    expect(verdict(proc(4040), lab, [customApp(proc(4040).image!, 'Google LLC')]).allow).toBe(true);
  });
});

describe('F-12 rule 4: what an allowed app starts', () => {
  it('F-12 python.exe started by VS Code is allowed; chrome.exe started by VS Code is not', () => {
    expect(ancestorsOf(proc(4030), lab).map((p) => p.pid)).toEqual([4020, 4010, 4000, 2000]);
    expect(verdict(proc(4030))).toEqual({ allow: true, why: 'child', profile: 'vscode' });
    expect(verdict(proc(4040))).toEqual({ allow: false, why: 'notAllowed', kind: 'browser' });
  });
  it("VS Code's own processes and its terminal are allowed", () => {
    expect(verdict(proc(4010))).toEqual({ allow: true, why: 'profile', profile: 'vscode' });
    expect(verdict(proc(4020))).toEqual({ allow: true, why: 'child', profile: 'vscode' });
  });
  it('a browser renamed python.exe and started from VS Code is still a browser: closed', () => {
    expect(fileName(proc(4050).image!)).toBe('python.exe');
    expect(verdict(proc(4050))).toEqual({ allow: false, why: 'notAllowed', kind: 'browser' });
  });
  it('a remote tool renamed python.exe and started from VS Code is closed', () => {
    expect(verdict({ ...proc(4030), product: 'AnyDesk' })).toEqual({ allow: false, why: 'notAllowed', kind: 'remote' });
  });
  it('Notepad started from VS Code\'s terminal is not on VS Code\'s list: closed', () => {
    expect(verdict(proc(4060))).toEqual({ allow: false, why: 'notAllowed', kind: 'app' });
  });
  it('python.exe not started by VS Code is closed', () => {
    expect(verdict({ ...proc(4030), parentPid: 1900 }).allow).toBe(false);
  });
  it('python.exe is closed when VS Code is not in the exam', () => {
    expect(verdict(proc(4030), lab, [word]).allow).toBe(false);
  });
  it('F-12 a link in Word does not open a browser: Edge started by Word is closed', () => {
    expect(verdict(proc(3020))).toEqual({ allow: false, why: 'notAllowed', kind: 'browser' });
  });
  it("Word's print helper is allowed", () => {
    expect(verdict(proc(3010))).toEqual({ allow: true, why: 'child', profile: 'word' });
  });
});

describe('F-12 rule 5: anything else', () => {
  it('a background process without a window is left alone', () => {
    expect(verdict(proc(5300))).toEqual({ allow: true, why: 'background' });
  });
  it('F-04 a remote-control tool is closed even in the background', () => {
    expect(verdict(proc(5000))).toEqual({ allow: false, why: 'alwaysClose', kind: 'remote' });
  });
  it('a local AI runner in the background is closed', () => {
    expect(verdict(proc(5100))).toEqual({ allow: false, why: 'alwaysClose', kind: 'app' });
  });
  it('a screen recorder in the background is closed', () => {
    expect(verdict({ ...proc(5300), image: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' })).toEqual({ allow: false, why: 'alwaysClose', kind: 'app' });
  });
  it('a protected process with no path and no window is left alone', () => {
    expect(verdict({ pid: 640, parentPid: 628, image: null, hasWindow: false })).toEqual({ allow: true, why: 'background' });
  });
});

describe('F-12 on recorded Windows computers (GitHub\'s runners, idle)', () => {
  it.each(['windows-server-2022-idle.json', 'windows-server-2025-idle.json'])('%s: only the windows that are a way out are closed', (file) => {
    const all = recording(file);
    const closed = all.filter((p) => !verdict(p, all).allow).map((p) => fileName(p.image!)).sort();
    const expected = ['explorer.exe', 'hosted-compute-agent'];
    if (file.includes('2025')) expected.push('WindowsTerminal.exe');
    expect(closed).toEqual(expected.sort());
  });
  it('no process without a window is closed, and the text input window stays', () => {
    const all = recording('windows-server-2022-idle.json');
    expect(all.filter((p) => !p.hasWindow && !verdict(p, all).allow)).toEqual([]);
    const textInput = all.find((p) => p.image?.endsWith('TextInputHost.exe'))!;
    expect(textInput.hasWindow).toBe(true);
    expect(verdict(textInput, all)).toEqual({ allow: true, why: 'system' });
  });
});

describe('ancestorsOf', () => {
  it('stops at a parent that is gone', () => {
    expect(ancestorsOf(proc(5000), lab)).toEqual([]);
  });
  it('stops if the parents go round in a circle (a reused pid)', () => {
    const a = { pid: 1, parentPid: 2, image: null, hasWindow: false };
    const b = { pid: 2, parentPid: 1, image: null, hasWindow: false };
    expect(ancestorsOf(a, [a, b])).toEqual([b]);
    const own = { pid: 0, parentPid: 0, image: null, hasWindow: false };
    expect(ancestorsOf(own, [own])).toEqual([]);
  });
});
