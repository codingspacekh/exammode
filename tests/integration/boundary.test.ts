import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/** The layers of architecture §2.2, enforced by ESLint: a planted bad import must fail, a good one must pass. */
const eslint = new ESLint();
async function problems(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}
/** An import that is used: `what` is `* as x` or `{ name }`. */
const importing = (what: string, from: string): string => `import ${what} from '${from}';\nexport const y = ${what.startsWith('{') ? what.slice(1, -1).trim() : 'x'};\n`;
const LAYER = 'layers/imports';
const PACKAGE = 'no-restricted-imports';

describe('architecture §2.2: the domain is pure and depends on nothing', () => {
  it.each(['electron', 'node:fs/promises', 'koffi', 'readline', 'dns', 'ws'])('src/domain may not import %s', async (pkg) => {
    expect(await problems(importing('* as x', pkg), 'src/domain/session/x.ts')).toContain(PACKAGE);
  });
  it('src/domain may not use the DOM or process', async () => {
    expect(await problems('export const w = window.innerWidth;\n', 'src/domain/x.ts')).toContain('no-restricted-globals');
    expect(await problems('export const p = process.pid;\n', 'src/domain/x.ts')).toContain('no-restricted-globals');
  });
  it.each(['@contracts/network/messages', '@application/student/flow', '@infrastructure/crypto/keys', '../../main/index', '../../guard/main'])('src/domain may not import %s', async (spec) => {
    expect(await problems(importing('* as x', spec), 'src/domain/session/x.ts')).toContain(LAYER);
  });
  it('src/domain may import zod and itself — domain/guard is not the Guard', async () => {
    expect(await problems(importing('{ z }', 'zod'), 'src/domain/x.ts')).toEqual([]);
    expect(await problems(importing('{ decide }', '../guard/decide'), 'src/domain/lockdown/x.ts')).toEqual([]);
  });
});

describe('architecture §2.2: the contracts are the APIs — pure, and only the domain', () => {
  it('src/contracts may import the domain and zod', async () => {
    expect(await problems(importing('{ z }', 'zod'), 'src/contracts/network/x.ts')).toEqual([]);
    expect(await problems(importing('* as x', '@domain/session/attempt'), 'src/contracts/network/x.ts')).toEqual([]);
  });
  it('src/contracts may not import a use case, an adapter, or Node', async () => {
    expect(await problems(importing('* as x', '@application/teacher/desk'), 'src/contracts/ipc/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', '@infrastructure/network/server'), 'src/contracts/ipc/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', 'node:http'), 'src/contracts/network/x.ts')).toContain(PACKAGE);
  });
});

describe('architecture §2.2: a use case knows the domain, the contracts and its ports', () => {
  it('src/application may import the domain, the contracts and the ports', async () => {
    expect(await problems(importing('* as x', '@domain/session/attempt'), 'src/application/teacher/x.ts')).toEqual([]);
    expect(await problems(importing('* as x', '@contracts/network/messages'), 'src/application/teacher/x.ts')).toEqual([]);
    expect(await problems(importing('* as x', '../ports/clock'), 'src/application/teacher/x.ts')).toEqual([]);
  });
  it('src/application may not import an adapter, a composition root or the screens', async () => {
    expect(await problems(importing('* as x', '@infrastructure/persistence/store'), 'src/application/teacher/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', '../../infrastructure/persistence/store'), 'src/application/teacher/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', '../../main/shell/windows'), 'src/application/student/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', '@/App'), 'src/application/student/x.ts')).toContain(LAYER);
  });
  it.each(['electron', 'node:fs/promises', 'node:crypto', 'ws', 'koffi'])('src/application may not import %s: I/O is a port', async (pkg) => {
    expect(await problems(importing('* as x', pkg), 'src/application/student/x.ts')).toContain(PACKAGE);
  });
  it('the teacher\'s side and a lab computer\'s side don\'t reach into each other', async () => {
    expect(await problems(importing('* as x', '../student/session'), 'src/application/teacher/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', '@application/teacher/desk'), 'src/application/student/x.ts')).toContain(LAYER);
    // what both sides need is beside them
    expect(await problems(importing('* as x', '../licence/licence'), 'src/application/teacher/x.ts')).toEqual([]);
  });
});

describe('architecture §2.2: an adapter implements a port', () => {
  it('src/infrastructure may import the ports, the contracts, the domain and Node', async () => {
    expect(await problems(importing('* as x', '@application/ports/clock'), 'src/infrastructure/fs/x.ts')).toEqual([]);
    expect(await problems(importing('* as x', '@contracts/network/messages'), 'src/infrastructure/network/x.ts')).toEqual([]);
    expect(await problems(importing('* as x', 'node:fs/promises'), 'src/infrastructure/fs/x.ts')).toEqual([]);
    expect(await problems(importing('* as x', '../guard/channel'), 'src/infrastructure/windows/x.ts')).toEqual([]);
  });
  it('src/infrastructure may not import a use case, a composition root, or Electron', async () => {
    expect(await problems(importing('* as x', '@application/student/launcher'), 'src/infrastructure/windows/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', '../../main/shell/windows'), 'src/infrastructure/windows/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', '../../guard/main'), 'src/infrastructure/windows/x.ts')).toContain(LAYER);
    expect(await problems(importing('{ app }', 'electron'), 'src/infrastructure/fs/x.ts')).toContain(PACKAGE);
  });
});

describe('architecture §2.2: the composition roots and the screens', () => {
  it('the Guard program builds from every inner layer, but knows neither Electron nor the app', async () => {
    expect(await problems(importing('* as x', '@infrastructure/windows/run'), 'src/guard/x.ts')).toEqual([]);
    expect(await problems(importing('* as x', '@application/guard/guard'), 'src/guard/x.ts')).toEqual([]);
    expect(await problems(importing('{ app }', 'electron'), 'src/guard/x.ts')).toContain(PACKAGE);
    expect(await problems(importing('* as x', '../main/index'), 'src/guard/x.ts')).toContain(LAYER);
  });
  it('the renderer may not import Node, Electron, a use case or an adapter (only the preload API)', async () => {
    expect(await problems(importing('{ app }', 'electron'), 'src/renderer/x.ts')).toContain(PACKAGE);
    expect(await problems(importing('* as x', 'node:fs'), 'src/renderer/x.ts')).toContain(PACKAGE);
    expect(await problems(importing('* as x', '@application/teacher/desk'), 'src/renderer/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', '@infrastructure/crypto/keys'), 'src/renderer/x.ts')).toContain(LAYER);
    expect(await problems(importing('* as x', '@contracts/ipc/state'), 'src/renderer/x.ts')).toEqual([]);
  });
  it('the preload knows only the contracts', async () => {
    expect(await problems(importing('* as x', '@contracts/ipc/calls'), 'src/preload/x.ts')).toEqual([]);
    expect(await problems(importing('* as x', '@application/student/flow'), 'src/preload/x.ts')).toContain(LAYER);
  });
  it('the renderer may not use a native <select> (N-07: shadcn/ui only)', async () => {
    expect(await problems('export const S = () => <select />;\n', 'src/renderer/screens/student/x.tsx')).toContain('no-restricted-syntax');
  });
});
