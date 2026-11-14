/**
 * The lockdown plan (architecture §2.4 step 2): the exam's rules and profiles as a list of reversible changes, in
 * the order the Guard makes them. Pure. To add a lockdown change, add it here; its undo is the journal's.
 */
import type { AppProfile } from '../profiles/schema';
import type { Change, FirewallRule } from './journal';

export interface PlanInput {
  /** the SID of the lab computer's account: its policies are under HKU\<SID> */
  userSid: string;
  runId: string;
  /** the installed ExamMode.exe and ExamModeGuard.exe (D10) */
  examMode: string;
  guard: string;
  teacher: { address: string; port: number };
  /** does the exam have websites? Only then may ExamMode reach the internet (F-23) */
  websites: boolean;
  profiles: AppProfile[];
}

const SVCHOST = '%SystemRoot%\\System32\\svchost.exe';

export function plan(input: PlanInput): Change[] {
  const user = `HKU\\${input.userSid}\\Software`;
  const machine = 'HKLM\\SOFTWARE';
  const value = (target: string, after: number | string): Change => ({ kind: 'registry', target, after });
  const rule = (after: FirewallRule): Change => ({ kind: 'firewallRule', target: after.name, after });
  const toTeacher = { protocol: 'tcp' as const, remoteAddress: input.teacher.address, remotePorts: [input.teacher.port] };

  const changes: Change[] = [
    // first, so that a power cut while locking still brings ExamMode back when Windows starts (F-20)
    value(`${user}\\Microsoft\\Windows\\CurrentVersion\\Run\\ExamMode`, `"${input.examMode}" --resume ${input.runId}`),
    // the user's policies: Ctrl+Alt+Del's screen emptied; no Run, no Windows-key shortcuts (F-14)
    ...['DisableTaskMgr', 'DisableLockWorkstation', 'DisableChangePassword'].map((name) => value(`${user}\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\${name}`, 1)),
    ...['NoLogoff', 'NoRun', 'NoWinKeys'].map((name) => value(`${user}\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\${name}`, 1)),
    value(`${user}\\Policies\\Microsoft\\Windows\\WindowsCopilot\\TurnOffWindowsCopilot`, 1),
    // the machine's policies: clipboard history (F-06), switching user, Recall
    value(`${machine}\\Policies\\Microsoft\\Windows\\System\\AllowClipboardHistory`, 0),
    value(`${machine}\\Policies\\Microsoft\\Windows\\System\\AllowCrossDeviceClipboard`, 0),
    value(`${machine}\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\HideFastUserSwitching`, 1),
    value(`${machine}\\Policies\\Microsoft\\Windows\\WindowsAI\\DisableAIDataAnalysis`, 1),
    // each allowed app's own ways out, turned off (§1.7)
    ...input.profiles.flatMap((p) => p.policies.map((policy) => value(`${policy.hive === 'user' ? user : machine}\\${policy.key.replace(/^Software\\/i, '')}\\${policy.name}`, policy.value))),
    // the firewall (§2.6): first the rules that keep the teacher reachable, then outbound blocked
    rule({ name: 'ExamMode: the teacher', program: input.examMode, ...toTeacher }),
    rule({ name: 'ExamMode: the Guard to the teacher', program: input.guard, ...toTeacher }),
    ...(input.websites ? [rule({ name: "ExamMode: the exam's websites", program: input.examMode, protocol: 'tcp', remotePorts: [80, 443] })] : []),
    // our own DNS and DHCP rules, in case a school has turned Windows' built-in ones off (M0, finding 3)
    rule({ name: 'ExamMode: DNS', program: SVCHOST, service: 'Dnscache', protocol: 'udp', remotePorts: [53] }),
    rule({ name: 'ExamMode: DHCP', program: SVCHOST, service: 'Dhcp', protocol: 'udp', localPorts: [68], remotePorts: [67] }),
    // the firewall on, on every profile (a school may have switched one off), then nothing out but our rules
    ...(['domain', 'private', 'public'] as const).map((target): Change => ({ kind: 'firewallState', target, after: 'on' })),
    ...(['domain', 'private', 'public'] as const).map((target): Change => ({ kind: 'firewallOutbound', target, after: 'block' })),
    // Explorer last (D7); Windows is told not to start it again first (M0, finding 2)
    value(`${machine}\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\AutoRestartShell`, 0),
    { kind: 'explorer', target: 'shell', after: 'stopped' },
  ];
  // a value two apps both set is changed once
  const seen = new Set<string>();
  return changes.filter((c) => !seen.has(`${c.kind} ${c.target}`) && seen.add(`${c.kind} ${c.target}`));
}
