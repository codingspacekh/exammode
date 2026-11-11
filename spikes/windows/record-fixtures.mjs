// MILESTONES §3.1: record this computer's processes (path, signer, product, parent, visible window) and installed apps,
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
// one PowerShell for every signature (hundreds of programs)
const signers = {};
const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
const sigs = paths.length ? w.psJson(`@(${list}) | ForEach-Object { Get-AuthenticodeSignature -LiteralPath $_ } | Select-Object Path,@{n='Status';e={"$($_.Status)"}},@{n='Signer';e={$_.SignerCertificate.Subject}},@{n='Product';e={(Get-Item -LiteralPath $_.Path).VersionInfo.ProductName}}`) : [];
for (const s of [sigs ?? []].flat()) signers[s.Path] = s;
const records = procs.map((p) => ({
  pid: p.ProcessId, parentPid: p.ParentProcessId, name: p.Name, image: p.ExecutablePath ?? null,
  signer: p.ExecutablePath ? signers[p.ExecutablePath]?.Signer ?? null : null,
  signature: p.ExecutablePath ? signers[p.ExecutablePath]?.Status ?? null : null,
  // the file's ProductName: a renamed browser still says Google Chrome (decide(), architecture §2.5)
  product: p.ExecutablePath ? signers[p.ExecutablePath]?.Product ?? null : null,
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
