import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/** The layer rules of architecture §2.2, enforced by ESLint: a planted bad import must fail. */
const eslint = new ESLint();
async function problems(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

describe('architecture §2.2 layer boundaries', () => {
  it('src/lib may not import Electron', async () => {
    expect(await problems("import { app } from 'electron';\nexport const a = app;\n", 'src/lib/session/x.ts')).toContain('no-restricted-imports');
  });
  it('src/lib may not import Node built-ins', async () => {
    expect(await problems("import { readFile } from 'node:fs/promises';\nexport const r = readFile;\n", 'src/lib/files/x.ts')).toContain('no-restricted-imports');
  });
  it('src/lib may not import koffi', async () => {
    expect(await problems("import koffi from 'koffi';\nexport const k = koffi;\n", 'src/lib/guard/x.ts')).toContain('no-restricted-imports');
  });
  it('src/lib may not use the DOM', async () => {
    expect(await problems('export const w = window.innerWidth;\n', 'src/lib/x.ts')).toContain('no-restricted-globals');
  });
  it('src/lib may import zod', async () => {
    expect(await problems("import { z } from 'zod';\nexport const s = z.string();\n", 'src/lib/protocol/x.ts')).toEqual([]);
  });
  it('the renderer may not import Node or Electron (only the preload API)', async () => {
    expect(await problems("import { app } from 'electron';\nexport const a = app;\n", 'src/renderer/x.ts')).toContain('no-restricted-imports');
    expect(await problems("import { readFile } from 'node:fs';\nexport const r = readFile;\n", 'src/renderer/x.ts')).toContain('no-restricted-imports');
  });
  it('the renderer may not use a native <select> (N-07: shadcn/ui only)', async () => {
    expect(await problems('export const S = () => <select />;\n', 'src/renderer/student/x.tsx')).toContain('no-restricted-syntax');
  });
  it('src/lib may not import a Node built-in by its bare name either: any of them', async () => {
    expect(await problems("import { createInterface } from 'readline';\nexport const c = createInterface;\n", 'src/lib/x.ts')).toContain('no-restricted-imports');
    expect(await problems("import { lookup } from 'dns';\nexport const l = lookup;\n", 'src/lib/x.ts')).toContain('no-restricted-imports');
  });
  it('the teacher\'s side and a lab computer\'s side don\'t reach into each other, and neither knows Electron', async () => {
    expect(await problems("import { hashFile } from '../student/files';\nexport const h = hashFile;\n", 'src/main/teacher/x.ts')).toContain('no-restricted-imports');
    expect(await problems("import { TeacherDesk } from '../teacher/desk';\nexport const d = TeacherDesk;\n", 'src/main/student/x.ts')).toContain('no-restricted-imports');
    expect(await problems("import { app } from 'electron';\nexport const a = app;\n", 'src/main/teacher/x.ts')).toContain('no-restricted-imports');
    expect(await problems("import { app } from 'electron';\nexport const a = app;\n", 'src/main/student/x.ts')).toContain('no-restricted-imports');
    // what both sides need is beside them
    expect(await problems("import { hashFile } from '../files';\nexport const h = hashFile;\n", 'src/main/teacher/x.ts')).toEqual([]);
  });
  it('src/win, src/guard and src/trust don\'t reach into src/main, or know Electron', async () => {
    expect(await problems("import { findExe } from '../main/student/launcher';\nexport const f = findExe;\n", 'src/win/x.ts')).toContain('no-restricted-imports');
    expect(await problems("import { app } from 'electron';\nexport const a = app;\n", 'src/guard/x.ts')).toContain('no-restricted-imports');
    expect(await problems("import { Session } from '../main/student/session';\nexport const s = Session;\n", 'src/trust/x.ts')).toContain('no-restricted-imports');
    expect(await problems("import { run } from '../win/run';\nexport const r = run;\n", 'src/guard/x.ts')).toEqual([]);
  });
});
