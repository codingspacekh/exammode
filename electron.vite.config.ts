import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/** The layers of architecture §2.2 (domain, contracts, application, infrastructure); `@` is the renderer, as
 *  shadcn/ui expects (components.json). */
const layers = {
  '@domain': resolve('src/domain'),
  '@contracts': resolve('src/contracts'),
  '@application': resolve('src/application'),
  '@infrastructure': resolve('src/infrastructure'),
};

export default defineConfig({
  main: {
    resolve: { alias: layers },
  },
  preload: {
    resolve: { alias: layers },
    // A sandboxed preload must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: { alias: { ...layers, '@': resolve('src/renderer') } },
    plugins: [react(), tailwindcss()],
    // A fixed port of its own (MicroLab has 5391); strictPort: a busy port stops `npm run dev` instead of moving.
    server: { port: 5401, strictPort: true },
  },
});
