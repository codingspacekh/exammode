// D8 / F-23: block every program's outbound traffic but one, and put everything back.
// Is a DNS rule needed for the allowed program to reach a website by name?
import * as w from './win32.mjs';

const GROUP = 'ExamMode-spike';
const node = process.execPath.replace(/'/g, "''");
const curl = () => w.run('curl.exe', ['-s', '-m', '6', '-o', 'NUL', '-w', '%{http_code}', 'https://example.com']).out || '000';
const nodeFetch = () => w.run(process.execPath, ['-e', "fetch('https://example.com',{signal:AbortSignal.timeout(6000)}).then(r=>console.log(r.status)).catch(()=>console.log('000'))"]).out || '000';
const profiles = () => w.psJson('Get-NetFirewallProfile | Select-Object Name,Enabled,@{n="Out";e={"$($_.DefaultOutboundAction)"}}');

const result = { before: profiles(), baseline: { curl: curl(), node: nodeFetch() } };
const saved = result.before;
const timings = {};
try {
  let t = performance.now();
  w.ps(`Set-NetFirewallProfile -All -Enabled True; New-NetFirewallRule -Group '${GROUP}' -DisplayName 'spike: node' -Direction Outbound -Program '${node}' -Action Allow | Out-Null`);
  if (process.env.GITHUB_ACTIONS) {
    // keep GitHub's own runner reachable during the test
    w.ps(`Get-Process Runner.* -ErrorAction SilentlyContinue | ForEach-Object { New-NetFirewallRule -Group '${GROUP}' -DisplayName "spike: $($_.Name)" -Direction Outbound -Program $_.Path -Action Allow | Out-Null }`);
  }
  w.ps('Set-NetFirewallProfile -All -DefaultOutboundAction Block');
  timings.applyMs = Math.round(performance.now() - t);
  await w.sleep(1500);
  result.blockedNoDnsRule = { curl: curl(), node: nodeFetch() };

  w.ps(`New-NetFirewallRule -Group '${GROUP}' -DisplayName 'spike: dns' -Direction Outbound -Service Dnscache -Protocol UDP -RemotePort 53 -Action Allow | Out-Null`);
  await w.sleep(1500);
  result.blockedWithDnsRule = { curl: curl(), node: nodeFetch() };
} catch (e) {
  result.error = String(e?.stack ?? e);
} finally {
  const t = performance.now();
  for (const p of saved ?? []) {
    w.ps(`Set-NetFirewallProfile -Name '${p.Name}' -Enabled ${p.Enabled ? 'True' : 'False'} -DefaultOutboundAction ${p.Out}`);
  }
  w.ps(`Remove-NetFirewallRule -Group '${GROUP}' -ErrorAction SilentlyContinue`);
  timings.restoreMs = Math.round(performance.now() - t);
  await w.sleep(1500);
  result.after = { profiles: profiles(), curl: curl(), node: nodeFetch() };
}
result.timings = timings;
const ok = (code) => /^[23]\d\d$/.test(code);
result.dnsRuleNeeded = !ok(result.blockedNoDnsRule?.node ?? '000') && ok(result.blockedWithDnsRule?.node ?? '000');
result.pass = !ok(result.blockedWithDnsRule?.curl ?? '200') && ok(result.blockedWithDnsRule?.node ?? '000')
  && JSON.stringify(result.after.profiles) === JSON.stringify(saved) && ok(result.after.curl);
w.report(result);
