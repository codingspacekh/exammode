import { builtinModules } from 'node:module';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The layer rules of architecture §2.2 on top of the recommended ones:
 *  - lib: src/lib is pure — no Electron, Node built-ins, koffi, React or the DOM (D4);
 *  - renderer: no Node or Electron — only the preload API;
 *  - controls: no native <select> or date / time / colour / range / number inputs outside
 *    src/renderer/components/ui — only shadcn/ui controls reach the screen (N-07);
 *  - the main process's layers: the teacher's side and a lab computer's side don't reach into each other; only the
 *    shell (and index.ts, the preload) knows Electron; src/win, src/guard and src/trust don't reach into src/main.
 */
const nodeBuiltins = builtinModules.filter((name) => !name.startsWith('_'));
const noNode = nodeBuiltins.map((name) => ({ name, message: 'No Node built-ins here (architecture §2.2).' }));

export const lib = {
  'no-restricted-imports': ['error', {
    paths: [
      { name: 'electron', message: 'src/lib is pure: no Electron (architecture §2.2).' },
      { name: 'koffi', message: 'src/lib is pure: Windows calls go through src/win (architecture D2).' },
      { name: 'react', message: 'src/lib is pure: no React (architecture §2.2).' },
      { name: 'react-dom', message: 'src/lib is pure: no React (architecture §2.2).' },
      ...noNode,
    ],
    patterns: [{ group: ['node:*', 'electron/*', 'react-dom/*'], message: 'src/lib is pure (architecture §2.2).' }],
  }],
  'no-restricted-globals': ['error',
    { name: 'window', message: 'src/lib is pure: no DOM.' },
    { name: 'document', message: 'src/lib is pure: no DOM.' },
    { name: 'process', message: 'src/lib is pure: no Node.' },
  ],
};

export const renderer = {
  'no-restricted-imports': ['error', {
    paths: [
      { name: 'electron', message: 'The renderer reaches the system only through the preload API (architecture §2.2).' },
      { name: 'koffi', message: 'The renderer reaches the system only through the preload API (architecture §2.2).' },
      ...noNode,
    ],
    patterns: [{ group: ['node:*', 'electron/*'], message: 'The renderer reaches the system only through the preload API.' }],
  }],
};

const noElectron = { name: 'electron', message: 'Only src/main/shell, index.ts and the preload know Electron (architecture §2.2).' };
/** One side of the main process: no Electron, and not the other side. */
const side = (other) => ({
  'no-restricted-imports': ['error', { paths: [noElectron], patterns: [{ group: [`**/${other}/*`, `**/${other}`], message: `The ${other}'s side isn't reached from here: what both sides need is in src/lib or src/main (architecture §2.2).` }, { group: ['**/shell/*', 'electron/*'], message: 'Only the shell knows Electron.' }] }],
});
/** What the main process uses, and that doesn't use it back. */
export const below = {
  'no-restricted-imports': ['error', { paths: [noElectron], patterns: [{ group: ['**/main/*', '**/main/**', 'electron/*'], message: 'src/win, src/guard and src/trust are used by src/main: they don\'t reach into it (architecture §2.2).' }] }],
};

export const controls = {
  'no-restricted-syntax': ['error',
    { selector: "JSXOpeningElement[name.name='select']", message: 'Use Select from src/renderer/components/ui — never a native <select> (N-07).' },
    {
      selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value=/^(date|time|datetime-local|month|week|color|range|number)$/]",
      message: 'Use a shadcn/ui control from src/renderer/components/ui (N-07).',
    },
  ],
};

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'coverage/**', 'design/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'spikes/**', 'build-info/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx,mts}'], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
  { files: ['scripts/**/*.mjs', '*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } } },
  { files: ['src/lib/**/*.{ts,tsx}'], rules: lib },
  { files: ['src/renderer/**/*.{ts,tsx}'], rules: renderer },
  { files: ['src/main/teacher/**/*.ts'], rules: side('student') },
  { files: ['src/main/student/**/*.ts'], rules: side('teacher') },
  { files: ['src/win/**/*.ts', 'src/guard/**/*.ts', 'src/trust/**/*.ts'], rules: below },
  { files: ['src/renderer/**/*.tsx'], ignores: ['src/renderer/components/ui/**'], rules: controls },
);
