import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/** `@lib` is the pure core (architecture §2.2, D4); `@` is the renderer, as shadcn/ui expects (components.json). */
const lib = resolve('src/lib');

export default defineConfig({
  main: {
    resolve: { alias: { '@lib': lib } },
  },
  preload: {
    // A sandboxed preload must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: { alias: { '@lib': lib, '@': resolve('src/renderer') } },
    plugins: [react(), tailwindcss()],
    // A fixed port of its own (MicroLab has 5391); strictPort: a busy port stops `npm run dev` instead of moving.
    server: { port: 5401, strictPort: true },
  },
});
