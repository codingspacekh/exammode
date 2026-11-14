/**
 * The computer's processes, for the process guard and the checks (architecture §2.4 step 1, §2.5): which programs
 * run, which have a window on the screen and what its title says, who made them — and closing one. Windows calls
 * through koffi; the publisher and product name through one PowerShell call for many files, remembered by file.
 */
import { stat } from 'node:fs/promises';
import type * as Koffi from 'koffi';
import type { ProcInfo } from '@lib/profiles/match';
import { powershellJson } from './run';

interface Api {
  koffi: typeof Koffi.default;
  snapshot(): { pid: number; parentPid: number }[];
  imageOf(pid: number): string | null;
  /** every visible top-level window: its process and its title */
  windows(): { pid: number; title: string }[];
  terminate(pid: number): boolean;
  remoteSession(): boolean;
}
let api: Api | undefined;

async function load(): Promise<Api> {
  if (api) return api;
  const koffi = (await import('koffi')).default;
  const kernel32 = koffi.load('kernel32.dll');
  const user32 = koffi.load('user32.dll');
  const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
    dwSize: 'uint32', cntUsage: 'uint32', th32ProcessID: 'uint32', th32DefaultHeapID: 'uintptr', th32ModuleID: 'uint32', cntThreads: 'uint32',
    th32ParentProcessID: 'uint32', pcPriClassBase: 'long', dwFlags: 'uint32', szExeFile: koffi.array('uint16', 260),
  });
  const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr lParam)');
  const CreateToolhelp32Snapshot = kernel32.func('void * __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)');
  const Process32FirstW = kernel32.func('bool __stdcall Process32FirstW(void *snapshot, _Inout_ PROCESSENTRY32W *entry)');
  const Process32NextW = kernel32.func('bool __stdcall Process32NextW(void *snapshot, _Inout_ PROCESSENTRY32W *entry)');
  const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *h)');
  const TerminateProcess = kernel32.func('bool __stdcall TerminateProcess(void *h, uint32 code)');
  const WaitForSingleObject = kernel32.func('uint32 __stdcall WaitForSingleObject(void *h, uint32 ms)');
  const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ void *buf, _Inout_ uint32 *size)');
  const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr lParam)');
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)');
  const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)');
  const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ void *buf, int max)');
  const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
  const TH32CS_SNAPPROCESS = 0x2;
  const PROCESS_TERMINATE = 0x1;
  const SYNCHRONIZE = 0x100000;
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const SM_REMOTESESSION = 0x1000;

  api = {
    koffi,
    snapshot() {
      const found: { pid: number; parentPid: number }[] = [];
      const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
      if (!snap) return found;
      try {
        const entry: { dwSize: number; th32ProcessID?: number; th32ParentProcessID?: number } = { dwSize: koffi.sizeof(PROCESSENTRY32W) };
        for (let more = Process32FirstW(snap, entry); more; more = Process32NextW(snap, entry)) found.push({ pid: entry.th32ProcessID!, parentPid: entry.th32ParentProcessID! });
      } finally {
        CloseHandle(snap);
      }
      return found;
    },
    imageOf(pid) {
      const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
      if (!h) return null;
      try {
        const buf = Buffer.alloc(2048);
        const size = [1024];
        return QueryFullProcessImageNameW(h, 0, buf, size) ? buf.toString('utf16le', 0, size[0]! * 2) : null;
      } finally {
        CloseHandle(h);
      }
    },
    windows() {
      const found: { pid: number; title: string }[] = [];
      const each = koffi.register((hwnd: unknown) => {
        if (IsWindowVisible(hwnd)) {
          const pid = [0];
          GetWindowThreadProcessId(hwnd, pid);
          const buf = Buffer.alloc(1024);
          const length = GetWindowTextW(hwnd, buf, 511);
          found.push({ pid: pid[0]!, title: buf.toString('utf16le', 0, Math.max(0, length) * 2) });
        }
        return true;
      }, koffi.pointer(EnumWindowsProc));
      try {
        EnumWindows(each, 0);
      } finally {
        koffi.unregister(each);
      }
      return found;
    },
    terminate(pid) {
      const h = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, false, pid);
      if (!h) return false;
      try {
        const ended = Boolean(TerminateProcess(h, 1));
        WaitForSingleObject(h, 3000);
        return ended;
      } finally {
        CloseHandle(h);
      }
    },
    remoteSession: () => GetSystemMetrics(SM_REMOTESESSION) !== 0,
  };
  return api;
}

export interface FileFacts { signer?: string; product?: string }
const facts = new Map<string, { stamp: number; facts: FileFacts }>();

/** Who made these programs, and what they call themselves: asked once per file (and again only if it changed). */
export async function fileFacts(paths: string[]): Promise<Map<string, FileFacts>> {
  const stamps = new Map<string, number>();
  for (const path of new Set(paths)) stamps.set(path, await stat(path).then((s) => s.mtimeMs, () => 0));
  const unknown = [...stamps].filter(([path, stamp]) => facts.get(path)?.stamp !== stamp).map(([path]) => path);
  if (unknown.length > 0) {
    type Row = { Path: string; Signer: string | null; Product: string | null };
    const list = unknown.map((p) => `'${p.replaceAll("'", "''")}'`).join(',');
    // the publisher only of a signature that holds: its certificate's common name
    const rows = await powershellJson<Row[] | Row>(`@(${list}) | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_ -ErrorAction SilentlyContinue; $v = (Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue).VersionInfo; [pscustomobject]@{ Path = $_; Signer = $(if ($s -and $s.Status -eq 'Valid') { $s.SignerCertificate.GetNameInfo('SimpleName', $false) } else { $null }); Product = $v.ProductName } }`);
    for (const row of rows ? [rows].flat() : []) {
      facts.set(row.Path, { stamp: stamps.get(row.Path) ?? 0, facts: { ...(row.Signer ? { signer: row.Signer } : {}), ...(row.Product ? { product: row.Product } : {}) } });
    }
    // a file that couldn't be asked about is remembered as unknown, not asked about every half second
    for (const path of unknown) if (!facts.has(path) || facts.get(path)!.stamp !== stamps.get(path)) facts.set(path, { stamp: stamps.get(path) ?? 0, facts: {} });
  }
  return new Map([...stamps.keys()].map((path) => [path, facts.get(path)?.facts ?? {}]));
}

/** Is the publisher and product name of this file known already? */
export const factsKnown = (path: string): boolean => facts.has(path);

export interface Running extends ProcInfo { /** the titles of its windows on the screen */ titles: string[] }

/** Every process, with whether it has a window. `withFacts`: also who made it — a first time costs a second or
 *  more for many files; afterwards nothing. Without, only what is remembered is filled in. */
export async function listProcesses(withFacts = true): Promise<Running[]> {
  const win = await load();
  const titles = new Map<number, string[]>();
  for (const w of win.windows()) titles.set(w.pid, [...(titles.get(w.pid) ?? []), w.title]);
  const procs = win.snapshot().map((p) => ({ ...p, image: win.imageOf(p.pid) }));
  const images = procs.map((p) => p.image).filter((i): i is string => i !== null);
  const known = withFacts ? await fileFacts(images) : new Map(images.map((i) => [i, facts.get(i)?.facts ?? {}]));
  return procs.map((p) => ({ ...p, ...(p.image ? known.get(p.image) : {}), hasWindow: titles.has(p.pid), titles: titles.get(p.pid) ?? [] }));
}

export async function terminate(pid: number): Promise<boolean> {
  return (await load()).terminate(pid);
}

/** Is this computer being used over Remote Desktop? */
export async function remoteSession(): Promise<boolean> {
  return (await load()).remoteSession();
}

/** The computer's maker, model and BIOS: a virtual machine says so there (F-04). */
export async function machine(): Promise<{ manufacturer: string; model: string; bios: string }> {
  type Row = { Manufacturer: string | null; Model: string | null; Bios: string | null };
  const row = await powershellJson<Row>('$c = Get-CimInstance Win32_ComputerSystem; $b = Get-CimInstance Win32_BIOS; [pscustomobject]@{ Manufacturer = $c.Manufacturer; Model = $c.Model; Bios = "$($b.Manufacturer) $($b.Version) $($b.SMBIOSBIOSVersion)" }');
  return { manufacturer: row?.Manufacturer ?? '', model: row?.Model ?? '', bios: row?.Bios ?? '' };
}
