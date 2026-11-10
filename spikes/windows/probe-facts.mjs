// Q12 / R2 / F-04: the facts of this computer — Windows, CPU, memory, screens, remote session, virtual machine,
// and whether the signed-in account is an administrator (elevated now, or could be).
import os from 'node:os';
import * as w from './win32.mjs';

const SM_CXSCREEN = 0, SM_CYSCREEN = 1, SM_CMONITORS = 80, SM_REMOTESESSION = 0x1000;
const groups = w.run('whoami.exe', ['/groups', '/fo', 'csv', '/nh']).out;
const adminLine = groups.split(/\r?\n/).find((l) => l.includes('S-1-5-32-544')) ?? '';
const system = w.psJson('Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model');
const bios = w.psJson('Get-CimInstance Win32_BIOS | Select-Object Manufacturer,SerialNumber');
const vmWords = /vmware|virtualbox|qemu|kvm|parallels|xen|virtual machine|hyper-v|amazon ec2|google compute/i;
let defender = null;
try { defender = w.psJson('Get-MpComputerStatus | Select-Object AMRunningMode,RealTimeProtectionEnabled'); } catch { /* not available */ }

w.report({
  windows: `${os.version()} ${os.release()}`,
  cpu: os.cpus()[0]?.model,
  memoryGB: Number((os.totalmem() / 2 ** 30).toFixed(1)),
  screens: w.GetSystemMetrics(SM_CMONITORS),
  primaryScreenPx: `${w.GetSystemMetrics(SM_CXSCREEN)} × ${w.GetSystemMetrics(SM_CYSCREEN)}`,
  remoteSession: w.GetSystemMetrics(SM_REMOTESESSION) !== 0,
  user: os.userInfo().username,
  // in the Administrators group at all; "deny only" = an admin account whose program isn't elevated (UAC)
  accountIsAdministrator: adminLine !== '',
  elevatedNow: w.run('net.exe', ['session']).ok,
  adminGroupDenyOnly: /deny only/i.test(adminLine),
  system, bios,
  looksLikeVirtualMachine: vmWords.test(`${system?.Manufacturer} ${system?.Model} ${bios?.Manufacturer} ${bios?.SerialNumber}`),
  defender,
  pass: true,
});
