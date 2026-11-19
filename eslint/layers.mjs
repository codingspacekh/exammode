import { dirname, relative, resolve, sep } from 'node:path';

/**
 * The layer rule of architecture §2.2 — clean architecture, the dependencies point inwards:
 *
 *   domain ← contracts ← application ← infrastructure ← composition roots (main, guard)
 *                       ↖ renderer, preload (the contracts and the domain only)
 *
 * Every import under src/ is resolved to the file it really names (an alias or a relative path, however deep) and
 * the layer it lands in is checked against what the importing layer may know. Packages (Electron, Node, koffi…)
 * are no-restricted-imports' business, in eslint.config.mjs.
 */
const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'src');
const ALIASES = {
  '@domain/': 'domain',
  '@contracts/': 'contracts',
  '@application/': 'application',
  '@infrastructure/': 'infrastructure',
  '@/': 'renderer',
};

/** What each layer may import, besides itself. */
export const MAY_KNOW = {
  domain: [],
  contracts: ['domain'],
  application: ['domain', 'contracts'],
  infrastructure: ['domain', 'contracts', 'application'],
  guard: ['domain', 'contracts', 'application', 'infrastructure'],
  main: ['domain', 'contracts', 'application', 'infrastructure'],
  preload: ['contracts'],
  renderer: ['domain', 'contracts'],
};

const WHY = {
  domain: 'src/domain is the rules: it depends on nothing but itself',
  contracts: 'src/contracts are the APIs: they depend only on src/domain',
  application: 'a use case knows the domain, the contracts and its ports — never an adapter or a composition root',
  infrastructure: 'an adapter knows only the ports of the application (src/application/ports), never a use case or a composition root',
  guard: 'the Guard is its own program: never the Electron app or its screens',
  main: 'the main process never imports the screens',
  preload: 'the preload is the IPC contract made real: only src/contracts',
  renderer: 'the screens know only the contracts and the domain: the rest is behind the preload API',
};

/** The layer and the path inside src/ of a file, or undefined outside src/. */
function where(file) {
  const rel = relative(SRC, file);
  if (rel.startsWith('..') || rel === '') return undefined;
  const parts = rel.split(sep);
  return { layer: parts[0], parts };
}

function target(spec, from) {
  const alias = Object.keys(ALIASES).find((a) => spec.startsWith(a));
  if (alias) return resolve(SRC, ALIASES[alias], spec.slice(alias.length));
  if (spec.startsWith('.')) return resolve(dirname(from), spec);
  return undefined;
}

/** Why an import from one place to another breaks the layers, or undefined if it doesn't. */
export function broken(fromFile, spec) {
  const from = where(fromFile);
  if (!from || !(from.layer in MAY_KNOW)) return undefined;
  const to = target(spec, fromFile);
  const at = to && where(to);
  if (!at) return undefined;
  if (at.layer !== from.layer && !MAY_KNOW[from.layer].includes(at.layer)) return WHY[from.layer];
  // an adapter implements a port: of the application it knows only application/ports
  if (from.layer === 'infrastructure' && at.layer === 'application' && at.parts[1] !== 'ports') return WHY.infrastructure;
  // the two sides of the application don't reach into each other
  if (from.layer === 'application' && at.layer === 'application') {
    const [a, b] = [from.parts[1], at.parts[1]];
    if ((a === 'teacher' && b === 'student') || (a === 'student' && b === 'teacher')) {
      return `the ${b}'s side isn't reached from the ${a}'s: what both sides need is in src/domain, src/contracts or src/application`;
    }
  }
  return undefined;
}

const rule = {
  meta: { type: 'problem', schema: [], messages: { layer: "'{{spec}}' breaks the layers (architecture §2.2): {{why}}." } },
  create(context) {
    const file = context.filename;
    const check = (node) => {
      const spec = node.source?.value;
      if (typeof spec !== 'string') return;
      const why = broken(file, spec);
      if (why) context.report({ node: node.source, messageId: 'layer', data: { spec, why } });
    };
    // (`typeof import('…')` too)
    const checkType = (node) => check({ source: node.argument?.literal ?? node.argument });
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check, ImportExpression: check, TSImportType: checkType };
  },
};

export default { rules: { imports: rule } };
