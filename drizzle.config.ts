import { defineConfig } from 'drizzle-kit';

/** `npm run db:generate` writes the next migration from the tables in schema.ts (architecture §2.11). */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infrastructure/persistence/schema.ts',
  out: './src/infrastructure/persistence/migrations',
});
