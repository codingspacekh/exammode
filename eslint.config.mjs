import { builtinModules } from 'node:module';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import layers from './eslint/layers.mjs';

/**
 * Architecture §2.2. Which layer may import which is eslint/layers.mjs (`layers/imports`); here, which packages a
 * layer may use:
 *  - domain and contracts are pure: no Electron, Node built-ins, koffi, React, ws or the DOM (D4);
 *  - application: the use cases reach the system only through a port — the same list;
 *  - infrastructure: the adapters use Node, ws, koffi, Drizzle — never Electron or React;
 *  - guard: its own program — no Electron, no React (D3);
 *  - renderer: no Node or Electron — only the preload API; controls: no native <select> or date / time / colour /
 *    range / number inputs outside src/renderer/components/ui — only shadcn/ui controls reach the screen (N-07).
 */
const nodeBuiltins = builtinModules.filter((name) => !name.startsWith('_'));
const no = (names, message) => names.map((name) => ({ name, message }));
const restrict = (paths, group, message) => ({ 'no-restricted-imports': ['error', { paths, patterns: [{ group, message }] }] });

const IO = ['electron', 'koffi', 'react', 'react-dom', 'ws', 'busboy', 'drizzle-orm', ...nodeBuiltins];
const IO_PATTERNS = ['node:*', 'electron/*', 'react-dom/*', 'drizzle-orm/*'];
const pureGlobals = ['error',
  { name: 'window', message: 'Pure code: no DOM.' },
  { name: 'document', message: 'Pure code: no DOM.' },
  { name: 'process', message: 'Pure code: no Node.' },
];

export const domain = { ...restrict(no(IO, 'src/domain is pure (architecture §2.2).'), IO_PATTERNS, 'src/domain is pure (architecture §2.2).'), 'no-restricted-globals': pureGlobals };
export const contracts = { ...restrict(no(IO, 'src/contracts is pure (architecture §2.2).'), IO_PATTERNS, 'src/contracts is pure (architecture §2.2).'), 'no-restricted-globals': pureGlobals };
const PORT = 'A use case reaches the system only through a port (src/application/ports, architecture §2.2).';
export const application = { ...restrict(no(IO, PORT), IO_PATTERNS, PORT), 'no-restricted-globals': pureGlobals };
const ADAPTER = 'An adapter knows neither Electron nor React: only src/main does (architecture §2.2).';
export const infrastructure = restrict(no(['electron', 'react', 'react-dom'], ADAPTER), ['electron/*', 'react-dom/*'], ADAPTER);
const GUARD = 'The Guard is its own program: no Electron, no React (architecture D3).';
export const guardRoot = restrict(no(['electron', 'react', 'react-dom'], GUARD), ['electron/*', 'react-dom/*'], GUARD);
const RENDERER = 'The renderer reaches the system only through the preload API (architecture §2.2).';
export const renderer = restrict(no(['electron', 'koffi', ...nodeBuiltins], RENDERER), ['node:*', 'electron/*'], RENDERER);

/** Files that still break the layers: they do I/O themselves or reach a use case from an adapter. The refactor's
 *  phase 3 moves their I/O behind ports (src/application/ports) and takes each one off this list. Never add to it. */
export const NOT_YET_LAYERED = [
  'src/application/guard/guard.ts',
  'src/application/licence/licence.ts',
  'src/application/student/exam.ts',
  'src/application/student/flow.ts',
  'src/application/student/launcher.ts',
  'src/application/student/session.ts',
  'src/application/teacher/classroom.ts',
  'src/application/teacher/desk.ts',
  'src/infrastructure/guard/channel.ts',
  'src/infrastructure/network/server.ts',
  'src/infrastructure/windows/lockdown.ts',
  'src/infrastructure/windows/system.ts',
];

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
  { files: ['scripts/**/*.mjs', '*.mjs', 'eslint/**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } } },
  { files: ['src/**/*.{ts,tsx}'], plugins: { layers }, rules: { 'layers/imports': 'error' } },
  { files: ['src/domain/**/*.{ts,tsx}'], rules: domain },
  { files: ['src/contracts/**/*.{ts,tsx}'], rules: contracts },
  { files: ['src/application/**/*.ts'], rules: application },
  { files: ['src/infrastructure/**/*.ts'], rules: infrastructure },
  { files: ['src/guard/**/*.ts'], rules: guardRoot },
  { files: ['src/renderer/**/*.{ts,tsx}'], rules: renderer },
  { files: NOT_YET_LAYERED, rules: { 'layers/imports': 'off', 'no-restricted-imports': 'off', 'no-restricted-globals': 'off' } },
  { files: ['src/renderer/**/*.tsx'], ignores: ['src/renderer/components/ui/**'], rules: controls },
);
