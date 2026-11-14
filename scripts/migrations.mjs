// Writes src/main/teacher/store/migrations/index.ts from the .sql files that drizzle-kit generated, so the
// migrations are part of the program itself: nothing to find on disk when ExamMode is installed.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('../src/main/teacher/store/migrations/', import.meta.url));

export function migrationsModule() {
  const files = readdirSync(folder).filter((name) => name.endsWith('.sql')).sort();
  const entries = files.map((name) => `  // ${name}\n  ${JSON.stringify(readFileSync(folder + name, 'utf8').replaceAll('\r\n', '\n'))},`);
  return `/** Made by \`npm run db:generate\` from the .sql files here. Don't edit: change schema.ts and run it again. */\nexport const migrations: string[] = [\n${entries.join('\n')}\n];\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(folder + 'index.ts', migrationsModule());
  console.log('Wrote migrations/index.ts');
}
