import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = {
  '@lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
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
        test: { name: 'component', include: ['tests/component/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['tests/setup/component.ts'] },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/main/**', 'src/guard/**'],
      // index.ts and shell/ are Electron glue (the windows), proven by the e2e tests; the migrations are generated SQL
      exclude: ['src/main/index.ts', 'src/main/shell/**', 'src/main/teacher/store/migrations/**'],
      // MILESTONES §3: the rules are held highest
      thresholds: {
        'src/lib/session/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/lib/guard/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/lib/lockdown/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/lib/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'src/main/**': { lines: 85, branches: 85, functions: 85, statements: 85 },
        'src/guard/**': { lines: 85, branches: 85, functions: 85, statements: 85 },
      },
    },
  },
});
