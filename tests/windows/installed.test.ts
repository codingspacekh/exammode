import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isProgramPath } from '@lib/profiles/exam-apps';
import { inventory, PROTOCOL_VERSION } from '@lib/protocol/messages';
import { installed } from '../../src/win/installed';

/** F-31a on a real Windows: its own list of installed programs, read for the teacher's Add an app. */
describe('F-31a what this computer has installed', () => {
  it('reads the installed apps: each with a name and a program that is there, none of them part of Windows', async () => {
    const here = await installed();
    expect(here).toBeDefined();
    const { apps, profiles } = here!;
    console.log(`[installed] ${apps.length} apps, profiles: ${profiles.join(', ') || 'none'}; ${apps.slice(0, 12).map((a) => a.name).join(' | ')}`);
    expect(apps.length).toBeGreaterThan(0);
    const windows = (process.env.SystemRoot ?? 'C:\\Windows').toLowerCase();
    for (const app of apps) {
      expect(app.name).not.toBe('');
      expect(isProgramPath(app.exe)).toBe(true);
      expect(app.exe.toLowerCase().startsWith(`${windows}\\`)).toBe(false);
    }
    // most of the programs are where the list says (an entry left behind by an uninstall may not be)
    expect(apps.filter((a) => existsSync(a.exe)).length).toBeGreaterThan(apps.length / 2);
    // and it is a report the teacher's laptop takes
    expect(inventory.safeParse({ v: PROTOCOL_VERSION, pc: 'PC-01', ...here }).success).toBe(true);
  }, 120_000);
});
