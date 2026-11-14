import { describe, expect, it } from 'vitest';
import { LISTS } from '@lib/guard/lists';
import { appName, appsToClose, runChecks, unsavedIn, virtualMachine, type CheckFacts } from '@lib/lockdown/checks';
import type { ProcInfo } from '@lib/profiles/match';

const lab: CheckFacts = { guard: true, displays: 1, remoteSession: false, remoteTools: [], machine: { manufacturer: 'Dell Inc.', model: 'OptiPlex 3080', bios: 'Dell Inc. 2.18.0' } };

describe('F-04 the computer\'s checks', () => {
  it('a lab computer with one screen, nobody watching from afar, and ExamMode Guard running may start', () => {
    expect(runChecks(lab)).toEqual({
      ok: true,
      checks: [{ check: 'guard', ok: true }, { check: 'oneScreen', ok: true, found: undefined }, { check: 'noRemote', ok: true, found: undefined }, { check: 'realComputer', ok: true, found: undefined }],
    });
  });

  it('a second screen or a projector stops the exam from starting', () => {
    const { ok, checks } = runChecks({ ...lab, displays: 2 });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.check === 'oneScreen')).toEqual({ check: 'oneScreen', ok: false, found: '2 screens' });
  });

  it('remote control stops it: Remote Desktop, or a remote-control app that is running', () => {
    expect(runChecks({ ...lab, remoteSession: true, remoteTools: ['AnyDesk'] }).checks.find((c) => c.check === 'noRemote')).toEqual({ check: 'noRemote', ok: false, found: 'Remote Desktop, AnyDesk' });
    expect(runChecks({ ...lab, remoteTools: ['TeamViewer'] }).ok).toBe(false);
  });

  it('a virtual machine stops it, except for a development build that is told to allow one', () => {
    const vm = { ...lab, machine: { manufacturer: 'VMware, Inc.', model: 'VMware Virtual Platform', bios: 'Phoenix' } };
    expect(runChecks(vm).checks.at(-1)).toEqual({ check: 'realComputer', ok: false, found: 'VMware' });
    expect(runChecks({ ...vm, allowVirtual: true })).toMatchObject({ ok: true });
  });

  it('without ExamMode Guard the computer can\'t be locked, so the exam can\'t start', () => {
    expect(runChecks({ ...lab, guard: false })).toMatchObject({ ok: false, checks: [{ check: 'guard', ok: false }, {}, {}, {}] });
  });

  it('a virtual machine is known by its maker, its model or its BIOS', () => {
    const vm = (manufacturer: string, model: string, bios = '') => virtualMachine({ manufacturer, model, bios });
    expect(vm('innotek GmbH', 'VirtualBox')).toBe('VirtualBox');
    expect(vm('QEMU', 'Standard PC (Q35 + ICH9, 2009)')).toBe('QEMU');
    expect(vm('Microsoft Corporation', 'Virtual Machine')).toBe('Hyper-V');
    expect(vm('Parallels International GmbH.', 'Parallels ARM Virtual Machine')).toBe('Parallels');
    expect(vm('Xen', 'HVM domU')).toBe('Xen');
    expect(vm('Acme', 'Box', 'American Megatrends Hyper-V UEFI Release')).toBe('a virtual machine');
    // real computers, one of them Microsoft's own
    expect(vm('Microsoft Corporation', 'Surface Laptop 4')).toBeUndefined();
    expect(vm('LENOVO', '10M7S0AB00', 'LENOVO M1AKT59A')).toBeUndefined();
  });
});

describe('F-05 the apps that will be closed, listed before they are', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  const ctx = { allowed: [], always: LISTS, env, self: ['C:\\Program Files\\ExamMode\\ExamMode.exe'] };
  const proc = (pid: number, image: string, titles: string[], over: Partial<ProcInfo> = {}): ProcInfo & { titles: string[] } => ({ pid, parentPid: 1, image, hasWindow: titles.length > 0, titles, ...over });

  it('every program with a window that isn\'t part of the exam, by name, with its windows and a file that isn\'t saved', () => {
    const apps = appsToClose([
      proc(10, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['Inbox - Google Chrome'], { product: 'Google Chrome' }),
      proc(11, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['YouTube - Google Chrome'], { product: 'Google Chrome' }),
      proc(12, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [], { product: 'Google Chrome' }),
      proc(20, 'C:\\Windows\\System32\\notepad.exe', ['*notes.txt - Notepad'], { signer: 'Microsoft Windows' }),
      proc(30, 'C:\\Users\\lab\\AppData\\Local\\Discord\\app-1.0\\Discord.exe', ['', 'Discord']),
      // these may stay: Windows' own, and ExamMode
      proc(40, 'C:\\Windows\\System32\\dwm.exe', ['DWM'], { signer: 'Microsoft Windows' }),
      proc(50, 'C:\\Program Files\\ExamMode\\ExamMode.exe', ['ExamMode']),
    ], ctx);
    expect(apps).toEqual([
      { name: 'Discord', pids: [30], windows: 1 },
      { name: 'Google Chrome', pids: [10, 11], windows: 2 },
      { name: 'notepad', pids: [20], windows: 1, unsaved: 'notes.txt' },
    ]);
  });

  it('nothing to close on a computer where only Windows runs', () => {
    expect(appsToClose([proc(40, 'C:\\Windows\\System32\\dwm.exe', ['DWM'], { signer: 'Microsoft Windows' })], ctx)).toEqual([]);
  });

  it('a window\'s title says when its file isn\'t saved', () => {
    expect(unsavedIn('*notes.txt - Notepad')).toBe('notes.txt');
    expect(unsavedIn('● main.py - exam - Visual Studio Code')).toBe('main.py');
    expect(unsavedIn('Report.docx* - Word')).toBe('Report.docx');
    expect(unsavedIn('essay.txt •')).toBe('essay.txt');
    expect(unsavedIn('Report.docx - Word')).toBeUndefined();
    expect(unsavedIn('*')).toBeUndefined();
    expect(unsavedIn('')).toBeUndefined();
  });

  it('a program is called by its product name, else by its file', () => {
    expect(appName({ image: 'C:\\x\\chrome.exe', product: ' Google Chrome ' })).toBe('Google Chrome');
    expect(appName({ image: 'C:\\x\\Thonny.EXE' })).toBe('Thonny');
    expect(appName({ image: null })).toBe('A program');
    expect(appName({ image: 'C:\\Windows\\System32\\notepad.exe', product: 'Microsoft® Windows® Operating System' })).toBe('notepad');
    expect(appName({ image: null, product: 'Microsoft® Windows® Operating System' })).toBe('Microsoft® Windows® Operating System');
  });
});
