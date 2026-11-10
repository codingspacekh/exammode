// MILESTONES §3.1: record this computer's processes (path, signer, parent, visible window) and installed apps,
// for tests/fixtures/procs and tests/fixtures/inventory. Writes spikes/windows/out/<computer>-procs.json / -inventory.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import * as w from './win32.mjs';

const out = new URL('./out/', import.meta.url);
mkdirSync(out, { recursive: true });
const host = os.hostname();

const withWindow = new Set();
w.EnumWindows((hwnd) => {
  if (w.IsWindowVisible(hwnd)) { const pid = [0]; w.GetWindowThreadProcessId(hwnd, pid); withWindow.add(pid[0]); }
  return true;
}, 0);
const procs = w.psJson('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath') ?? [];
const paths = [...new Set(procs.map((p) => p.ExecutablePath).filter(Boolean))];
const signers = {};
for (const path of paths) {
  try {
    const s = w.psJson(`Get-AuthenticodeSignature -LiteralPath '${path.replace(/'/g, "''")}' | Select-Object @{n='Status';e={"$($_.Status)"}},@{n='Signer';e={$_.SignerCertificate.Subject}}`);
    signers[path] = s;
  } catch { signers[path] = null; }
}
const records = procs.map((p) => ({
  pid: p.ProcessId, parentPid: p.ParentProcessId, name: p.Name, image: p.ExecutablePath ?? null,
  signer: p.ExecutablePath ? signers[p.ExecutablePath]?.Signer ?? null : null,
  signature: p.ExecutablePath ? signers[p.ExecutablePath]?.Status ?? null : null,
  hasWindow: withWindow.has(p.ProcessId),
}));
writeFileSync(new URL(`${host}-procs.json`, out), JSON.stringify(records, null, 1));

const keys = [
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
];
const apps = w.psJson(`Get-ItemProperty ${keys.map((k) => `'${k}'`).join(',')} -ErrorAction SilentlyContinue | Where-Object DisplayName | Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation,DisplayIcon`) ?? [];
writeFileSync(new URL(`${host}-inventory.json`, out), JSON.stringify(apps, null, 1));

w.report({ processes: records.length, withWindow: records.filter((r) => r.hasWindow).length, installedApps: apps.length, pass: true });
