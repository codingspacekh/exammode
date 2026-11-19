/**
 * Starting a program on the desktop of whoever sits at the computer, from the Guard — a service, in session 0,
 * with no desktop of its own (architecture §2.4: Explorer after the exam; ExamMode with --resume after it stopped
 * suddenly). Windows calls through koffi.
 */
import type * as Koffi from 'koffi';

type Lib = Koffi.LibraryHandle;

interface Libs {
  koffi: typeof Koffi.default;
  kernel32: Lib; wtsapi32: Lib; advapi32: Lib; userenv: Lib;
}
let loaded: Libs | undefined;
async function libs(): Promise<Libs> {
  if (loaded) return loaded;
  const koffi = (await import('koffi')).default;
  loaded = { koffi, kernel32: koffi.load('kernel32.dll'), wtsapi32: koffi.load('wtsapi32.dll'), advapi32: koffi.load('advapi32.dll'), userenv: koffi.load('userenv.dll') };
  return loaded;
}

/** The session this process is in: 0 for a service. */
export async function ownSession(): Promise<number> {
  const { kernel32 } = await libs();
  const id = [0];
  kernel32.func('bool __stdcall ProcessIdToSessionId(uint32 pid, _Out_ uint32 *session)')(process.pid, id);
  return id[0]!;
}

/** Starts `commandLine` in the active console session, as its user. False: this process isn't a service (it can
 *  simply start the program itself), or nobody is at the computer. */
export function startInUserSession(commandLine: string): boolean {
  if (process.platform !== 'win32' || !loaded) return false;
  return launch(loaded, commandLine);
}

/** Loads Windows' libraries; after this `startInUserSession` can be used. Answers whether this is a service. */
export async function prepareSessions(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  await libs();
  return (await ownSession()) === 0;
}

function launch({ koffi, kernel32, wtsapi32, advapi32, userenv }: Libs, commandLine: string): boolean {
  const HANDLE = 'void *';
  const WTSGetActiveConsoleSessionId = kernel32.func('uint32 __stdcall WTSGetActiveConsoleSessionId()');
  const ProcessIdToSessionId = kernel32.func('bool __stdcall ProcessIdToSessionId(uint32 pid, _Out_ uint32 *session)');
  const CloseHandle = kernel32.func(`bool __stdcall CloseHandle(${HANDLE} h)`);
  const WTSQueryUserToken = wtsapi32.func(`bool __stdcall WTSQueryUserToken(uint32 session, _Out_ ${HANDLE} *token)`);
  const DuplicateTokenEx = advapi32.func(`bool __stdcall DuplicateTokenEx(${HANDLE} token, uint32 access, void *attributes, int level, int type, _Out_ ${HANDLE} *copy)`);
  const CreateEnvironmentBlock = userenv.func(`bool __stdcall CreateEnvironmentBlock(_Out_ ${HANDLE} *env, ${HANDLE} token, bool inherit)`);
  const DestroyEnvironmentBlock = userenv.func(`bool __stdcall DestroyEnvironmentBlock(${HANDLE} env)`);
  const STARTUPINFOW = koffi.struct({
    cb: 'uint32', lpReserved: 'void *', lpDesktop: 'str16', lpTitle: 'void *', dwX: 'uint32', dwY: 'uint32', dwXSize: 'uint32', dwYSize: 'uint32',
    dwXCountChars: 'uint32', dwYCountChars: 'uint32', dwFillAttribute: 'uint32', dwFlags: 'uint32', wShowWindow: 'uint16', cbReserved2: 'uint16',
    lpReserved2: 'void *', hStdInput: 'void *', hStdOutput: 'void *', hStdError: 'void *',
  });
  const PROCESS_INFORMATION = koffi.struct({ hProcess: 'void *', hThread: 'void *', dwProcessId: 'uint32', dwThreadId: 'uint32' });
  const CreateProcessAsUserW = advapi32.func('bool __stdcall CreateProcessAsUserW(void *token, void *app, str16 commandLine, void *pa, void *ta, bool inherit, uint32 flags, void *env, void *dir, _In_ void *startup, _Out_ void *info)');

  const own = [0];
  ProcessIdToSessionId(process.pid, own);
  // not a service: this process has a desktop of its own
  if (own[0] !== 0) return false;
  const session = WTSGetActiveConsoleSessionId();
  if (session === 0xffffffff) return false;
  const token: unknown[] = [null];
  if (!WTSQueryUserToken(session, token)) return false;
  const primary: unknown[] = [null];
  const env: unknown[] = [null];
  try {
    // MAXIMUM_ALLOWED, SecurityIdentification, TokenPrimary
    if (!DuplicateTokenEx(token[0], 0x02000000, null, 1, 1, primary)) return false;
    CreateEnvironmentBlock(env, primary[0], false);
    const startup = { cb: koffi.sizeof(STARTUPINFOW), lpDesktop: 'winsta0\\default' };
    const info = {};
    // CREATE_UNICODE_ENVIRONMENT | CREATE_NEW_CONSOLE
    const started = CreateProcessAsUserW(primary[0], null, commandLine, null, null, false, 0x00000400 | 0x00000010, env[0], null, koffi.as(startup, koffi.pointer(STARTUPINFOW)), koffi.as(info, koffi.pointer(PROCESS_INFORMATION)));
    return Boolean(started);
  } finally {
    if (env[0]) DestroyEnvironmentBlock(env[0]);
    if (primary[0]) CloseHandle(primary[0]);
    CloseHandle(token[0]);
  }
}
