import { describe, expect, it } from 'vitest';
import { lockAsk, plan, planAsked, type LockAsk, type PlanInput } from '@lib/lockdown/plan';
import { builtin } from '@lib/profiles/builtin';
import type { Change } from '@lib/lockdown/journal';
import { vscode, word } from '../../fixtures/profiles';

const SID = 'S-1-5-21-1004336348-1177238915-682003330-1001';
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  userSid: SID, runId: 'r-1',
  examMode: 'C:\\Program Files\\ExamMode\\ExamMode.exe', guard: 'C:\\Program Files\\ExamMode\\ExamModeGuard.exe',
  teacher: { address: '192.168.1.20', port: 47800 }, websites: false, profiles: [word, vscode], ...over,
});
const registry = (changes: Change[]) => Object.fromEntries(changes.filter((c) => c.kind === 'registry').map((c) => [c.target, c.after]));
const rules = (changes: Change[]) => changes.filter((c) => c.kind === 'firewallRule').map((c) => c.after);
const USER = `HKU\\${SID}\\Software`;

/** The lockdown plan of architecture §2.4, step 2: a list of reversible changes. */
describe('§2.4 the plan: policies', () => {
  const values = registry(plan(input()));
  it('F-14 the user policies empty the Ctrl+Alt+Del screen and turn off Run and the Windows keys', () => {
    expect(values).toMatchObject({
      [`${USER}\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\DisableTaskMgr`]: 1,
      [`${USER}\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\DisableLockWorkstation`]: 1,
      [`${USER}\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\DisableChangePassword`]: 1,
      [`${USER}\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoLogoff`]: 1,
      [`${USER}\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoRun`]: 1,
      [`${USER}\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoWinKeys`]: 1,
    });
  });
  it('F-06 clipboard history and the cross-device clipboard are off; so are switching user, Copilot and Recall', () => {
    expect(values).toMatchObject({
      'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System\\AllowClipboardHistory': 0,
      'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System\\AllowCrossDeviceClipboard': 0,
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\HideFastUserSwitching': 1,
      'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI\\DisableAIDataAnalysis': 1,
      [`${USER}\\Policies\\Microsoft\\Windows\\WindowsCopilot\\TurnOffWindowsCopilot`]: 1,
    });
  });
  it('F-20 ExamMode starts when Windows starts, to come back to this run', () => {
    expect(values[`${USER}\\Microsoft\\Windows\\CurrentVersion\\Run\\ExamMode`]).toBe('"C:\\Program Files\\ExamMode\\ExamMode.exe" --resume r-1');
  });
  it("each allowed app's own policies are in, under the user's hive or the machine's", () => {
    expect(values[`${USER}\\Policies\\Microsoft\\Office\\16.0\\Common\\Privacy\\DisconnectedState`]).toBe(2);
    const machine = { ...word, policies: [{ hive: 'machine' as const, key: 'SOFTWARE\\Policies\\Sample', name: 'Off', value: 'yes' }] };
    expect(registry(plan(input({ profiles: [machine] })))['HKLM\\SOFTWARE\\Policies\\Sample\\Off']).toBe('yes');
  });
  it('a value two apps both set is changed once', () => {
    const excel = { ...word, id: 'excel' };
    const targets = plan(input({ profiles: [word, excel] })).map((c) => `${c.kind} ${c.target}`);
    expect(new Set(targets).size).toBe(targets.length);
  });
  it('an exam with no apps still locks the computer', () => {
    expect(Object.keys(registry(plan(input({ profiles: [] })))).length).toBeGreaterThan(10);
  });
});

describe('§2.6 the plan: the firewall', () => {
  it('F-23 ExamMode and the Guard reach only the teacher; DNS and DHCP stay; nothing else', () => {
    expect(rules(plan(input()))).toEqual([
      { name: 'ExamMode: the teacher', program: 'C:\\Program Files\\ExamMode\\ExamMode.exe', protocol: 'tcp', remoteAddress: '192.168.1.20', remotePorts: [47800] },
      { name: 'ExamMode: the Guard to the teacher', program: 'C:\\Program Files\\ExamMode\\ExamModeGuard.exe', protocol: 'tcp', remoteAddress: '192.168.1.20', remotePorts: [47800] },
      { name: 'ExamMode: DNS', program: '%SystemRoot%\\System32\\svchost.exe', service: 'Dnscache', protocol: 'udp', remotePorts: [53] },
      { name: 'ExamMode: DHCP', program: '%SystemRoot%\\System32\\svchost.exe', service: 'Dhcp', protocol: 'udp', localPorts: [68], remotePorts: [67] },
    ]);
  });
  it('F-23 only an exam with websites lets ExamMode reach the internet, on ports 80 and 443', () => {
    const web = rules(plan(input({ websites: true })));
    expect(web).toHaveLength(5);
    expect(web).toContainEqual({ name: 'ExamMode: the exam\'s websites', program: 'C:\\Program Files\\ExamMode\\ExamMode.exe', protocol: 'tcp', remotePorts: [80, 443] });
  });
  it('the firewall is switched on on every profile before outbound traffic is blocked', () => {
    const changes = plan(input());
    const on = changes.filter((c) => c.kind === 'firewallState');
    expect(on.map((c) => [c.target, c.after])).toEqual([['domain', 'on'], ['private', 'on'], ['public', 'on']]);
    expect(changes.map((c) => c.kind).lastIndexOf('firewallState')).toBeLessThan(changes.findIndex((c) => c.kind === 'firewallOutbound'));
  });
  it('outbound traffic is blocked on every firewall profile', () => {
    const blocked = plan(input()).filter((c) => c.kind === 'firewallOutbound');
    expect(blocked.map((c) => [c.target, c.after])).toEqual([['domain', 'block'], ['private', 'block'], ['public', 'block']]);
  });
});

describe('§2.4 the plan: the order', () => {
  const changes = plan(input());
  const index = (find: (c: Change) => boolean) => changes.findIndex(find);
  it('the rules that keep the teacher reachable are made before outbound traffic is blocked', () => {
    const lastRule = changes.map((c) => c.kind).lastIndexOf('firewallRule');
    expect(lastRule).toBeLessThan(index((c) => c.kind === 'firewallOutbound'));
  });
  it('D7 Explorer is stopped last, after Windows is told not to start it again', () => {
    expect(changes.at(-1)).toEqual({ kind: 'explorer', target: 'shell', after: 'stopped' });
    expect(index((c) => c.target.endsWith('\\Winlogon\\AutoRestartShell') && c.after === 0)).toBeGreaterThan(-1);
  });
  it('the start-with-Windows entry is first, so a power cut during locking still brings ExamMode back', () => {
    expect(changes[0]?.target.endsWith('\\Run\\ExamMode')).toBe(true);
  });
});

describe('D3 what ExamMode asks the Guard for, and the plan the Guard makes of it', () => {
  const ask: LockAsk = { runId: '3f2a9c41-07be-4d25-8a55-1b2c3d4e5f60', userSid: SID, teacher: { address: '192.168.1.20', port: 47800 }, websites: true, profiles: ['word', 'not-a-profile'] };
  const on = { examMode: 'C:\\Program Files\\ExamMode\\ExamMode.exe', guard: 'C:\\Program Files\\ExamMode\\ExamModeGuard.exe' };
  it('is the plan for this account, this run and the built-in profiles — a profile the Guard doesn\'t know adds nothing', () => {
    expect(planAsked(ask, on)).toEqual(plan({ userSid: SID, runId: ask.runId, ...on, teacher: ask.teacher, websites: true, profiles: [builtin('word')!] }));
  });
  it('a program to keep reachable is kept only by a development Guard, before the firewall is switched on', () => {
    const kept = { ...ask, keepReachable: ['C:\\actions-runner\\bin\\Runner.Worker.exe'] };
    expect(planAsked(kept, on)).toEqual(planAsked(ask, on));
    const dev = planAsked(kept, { ...on, dev: true });
    expect(dev).toHaveLength(planAsked(ask, on).length + 1);
    const at = dev.findIndex((c) => c.target === 'ExamMode: kept reachable 1');
    expect(dev[at]).toMatchObject({ kind: 'firewallRule', after: { program: 'C:\\actions-runner\\bin\\Runner.Worker.exe', protocol: 'tcp' } });
    expect(dev[at + 1]).toMatchObject({ kind: 'firewallState' });
    expect(planAsked({ ...ask, keepReachable: [] }, { ...on, dev: true })).toEqual(planAsked(ask, on));
  });
  it('only what an exam needs can be asked: a run\'s id, an account\'s SID, an address, yes or no, profile ids', () => {
    expect(lockAsk.safeParse(ask).success).toBe(true);
    for (const bad of [
      { runId: 'r-1' }, { runId: `${ask.runId} --inspect` }, { userSid: 'S-1-5-21-1\\Software' }, { userSid: 'Everyone' },
      { teacher: { address: 'teacher-laptop', port: 47800 } }, { teacher: { address: '192.168.1.20', port: 70_000 } }, { websites: 1 }, { profiles: [''] },
    ]) expect(lockAsk.safeParse({ ...ask, ...bad }).success).toBe(false);
  });
});
