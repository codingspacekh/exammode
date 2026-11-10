// D10: with Electron's RunAsNode fuse off, `ELECTRON_RUN_AS_NODE=1 ExamMode.exe script` must run no script.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';

const require = createRequire(import.meta.url);
const electronExe = require('electron');   // the path to Electron's binary

function runsScript(exe) {
  return new Promise((resolve) => {
    const child = spawn(exe, ['-e', "console.log('RAN-AS-NODE')"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 8000);
    child.on('exit', () => { clearTimeout(timer); resolve(out.includes('RAN-AS-NODE')); });
  });
}

const result = {};
const dir = mkdtempSync(join(tmpdir(), 'exammode-fuses-'));
try {
  result.unfusedRunsScript = await runsScript(electronExe);
  const distDir = dirname(electronExe);
  cpSync(distDir, join(dir, 'dist'), { recursive: true });
  const copy = join(dir, 'dist', electronExe.slice(distDir.length + 1));
  await flipFuses(copy, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: process.platform === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
  result.fusedRunsScript = await runsScript(copy);
} catch (e) {
  result.error = String(e?.stack ?? e);
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
result.pass = result.unfusedRunsScript === true && result.fusedRunsScript === false;
console.log(`RESULT ${JSON.stringify(result)}`);
process.exit(0);
