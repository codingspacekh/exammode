// The M0 Windows spike: runs every probe and writes spikes/windows/out/<computer>-report.md (and .json).
//   node spikes/windows/run-all.mjs            — about 3 minutes (the keyboard hook for 60 s)
//   node spikes/windows/run-all.mjs --long     — the lab run: the keyboard hook for 30 minutes
//   node spikes/windows/run-all.mjs --only=firewall,explorer
// Run it from an administrator prompt: the firewall, Explorer and policy probes need it. Each one puts back what it changed.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const electron = createRequire(import.meta.url)('electron');
const long = process.argv.includes('--long');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');

const probes = [
  { name: 'facts', what: 'This computer (admin rights, VM, screens)', cmd: [process.execPath, here('probe-facts.mjs')] },
  { name: 'winevent', what: 'A new window is seen and closed within 1 s (N-02)', cmd: [process.execPath, here('probe-winevent.mjs')] },
  { name: 'keyboard', what: `The Windows key and Ctrl+Esc swallowed, hooks alive for ${long ? '30 min' : '60 s'} (R1, F-14)`, cmd: [process.execPath, here('probe-keyboard.mjs'), long ? '1800' : '60'], timeout: (long ? 1900 : 150) * 1000 },
  { name: 'appbar', what: 'The exam bar reserves the top; a maximised app fits under it (D6)', cmd: [electron, here('probe-appbar.mjs')] },
  { name: 'policies', what: 'DisableTaskMgr works at once and is put back (§2.4)', cmd: [process.execPath, here('probe-policies.mjs')] },
  { name: 'explorer', what: 'Explorer stopped, stays down, starts again (D7)', cmd: [process.execPath, here('probe-explorer.mjs')] },
  { name: 'firewall', what: 'Only one program reaches the internet; all put back (D8, F-23)', cmd: [process.execPath, here('probe-firewall.mjs')] },
  { name: 'fuses', what: 'With the RunAsNode fuse off, no script runs as Electron (D10)', cmd: [process.execPath, here('probe-fuses.mjs')] },
  { name: 'fixtures', what: 'Processes and installed apps recorded (MILESTONES §3.1)', cmd: [process.execPath, here('record-fixtures.mjs')], timeout: 600_000 },
].filter((p) => !only || only.includes(p.name));

function runProbe(p) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // Electron runs as plain Node when ELECTRON_RUN_AS_NODE is set at all, even empty: remove it
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(p.cmd[0], p.cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), p.timeout ?? 120_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).reverse().find((l) => l.startsWith('RESULT '));
      let result = null;
      try { result = line ? JSON.parse(line.slice(7)) : null; } catch { /* broken line */ }
      resolve({ name: p.name, what: p.what, seconds: Math.round((Date.now() - t0) / 1000), code, result, stderr: result ? undefined : err.slice(-2000) });
    });
  });
}

const results = [];
for (const p of probes) {
  process.stdout.write(`${p.name.padEnd(9)} … `);
  const r = await runProbe(p);
  results.push(r);
  console.log(r.result ? (r.result.pass ? 'pass' : 'FAIL') : 'NO RESULT', `(${r.seconds} s)`);
}

const host = os.hostname();
const outDir = here('out/');
mkdirSync(outDir, { recursive: true });
const report = { host, at: new Date().toISOString(), long, results };
writeFileSync(`${outDir}${host}-report.json`, JSON.stringify(report, null, 2));
const md = [
  `# M0 Windows spike — ${host}`, '', `${report.at}${long ? ' · long run' : ''}`, '',
  '| Probe | What it checks | Result |', '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.what} | ${r.result ? (r.result.pass ? '✅ pass' : '❌ fail') : '⚠️ no result'} |`),
  '', '## Details', '',
  ...results.flatMap((r) => [`### ${r.name}`, '', '```json', JSON.stringify(r.result ?? { stderr: r.stderr }, null, 2), '```', '']),
].join('\n');
writeFileSync(`${outDir}${host}-report.md`, md);
console.log(`\nReport: spikes/windows/out/${host}-report.md`);
