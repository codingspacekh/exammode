// Adds shadcn/ui components with the official CLI: `npm run ui:add -- dialog select`.
// The registry's Tailwind v4 files currently import `cn` from "cn" (an upstream bug, 2026-11-10);
// this points them at our utils (components.json: "@/lib/utils") afterwards.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('Usage: npm run ui:add -- <component> [more…]');
  process.exit(1);
}
execFileSync('npx', ['--yes', 'shadcn@latest', 'add', ...names, '--yes'], { stdio: 'inherit', shell: process.platform === 'win32' });

const dir = join('src', 'renderer', 'components', 'ui');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
  const path = join(dir, file);
  const text = readFileSync(path, 'utf8');
  const fixed = text.replace(/from "cn"/g, 'from "@/lib/utils"');
  if (fixed !== text) {
    writeFileSync(path, fixed);
    console.log(`fixed the cn import in ${path}`);
  }
}
