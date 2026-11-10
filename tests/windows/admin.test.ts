import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** The `windows` project runs only on Windows (CI windows-latest, a lab computer), as an administrator: the Guard's
 *  tests change the firewall and machine policies (MILESTONES §3). */
describe.runIf(process.platform === 'win32')('M0 the windows test project', () => {
  it('runs as an administrator', () => {
    // `net session` succeeds only in an elevated process
    expect(() => execFileSync('net', ['session'], { stdio: 'ignore' })).not.toThrow();
  });
});
