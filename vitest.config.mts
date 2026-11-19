import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = {
  '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
  '@contracts': fileURLToPath(new URL('./src/contracts', import.meta.url)),
  '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
  '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
  '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
};

/**
 * One Vitest project per test layer (docs/MILESTONES.md §3):
 *   npm test               → unit
 *   npm run test:all       → unit · integration · acceptance · component
 *   npm run test:windows   → windows (real Windows only; skipped elsewhere)
 * Playwright tests live in tests/e2e and run with `npm run e2e`.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    passWithNoTests: true,
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 15_000 } },
      // one file at a time: these tests change the one real computer they run on
      { extends: true, test: { name: 'windows', include: ['tests/windows/**/*.test.ts'], environment: 'node', testTimeout: 30_000, fileParallelism: false } },
      { extends: true, test: { name: 'acceptance', include: ['tests/acceptance/**/*.test.ts'], environment: 'node', testTimeout: 30_000 } },
      {
        extends: true,
        plugins: [react()],
        // (typing a form letter by letter takes a few seconds on a busy computer)
        test: { name: 'component', include: ['tests/component/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['tests/setup/component.ts'], testTimeout: 20_000 },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/contracts/**', 'src/application/**', 'src/infrastructure/**', 'src/guard/**'],
      // main/ is the Electron composition root and its glue (the windows), proven by the e2e tests; the migrations are
      // generated SQL … and the Guard's program, the real lock and the Windows adapters are Windows only (the windows
      // tests prove them)
      exclude: ['src/infrastructure/windows/**', 'src/guard/main.ts', 'src/infrastructure/persistence/migrations/**'],
      // MILESTONES §3: the rules are held highest
      thresholds: {
        'src/domain/session/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/domain/guard/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/domain/lockdown/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/infrastructure/crypto/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/domain/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'src/contracts/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'src/application/**': { lines: 85, branches: 85, functions: 85, statements: 85 },
        'src/infrastructure/**': { lines: 85, branches: 85, functions: 85, statements: 85 },
      },
    },
  },
});
