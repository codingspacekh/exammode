import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** ExamMode Guard as one file of its own, `out/guard/main.js` (architecture D3): it is not part of the Electron
 *  app. koffi stays outside the file: it is a native library. (As a single .exe: M8.) */
export default defineConfig({
  resolve: { alias: Object.fromEntries(['domain', 'contracts', 'application', 'infrastructure'].map((layer) => [`@${layer}`, fileURLToPath(new URL(`./src/${layer}`, import.meta.url))])) },
  ssr: { noExternal: true, external: ['koffi'] },
  build: { ssr: 'src/guard/main.ts', outDir: 'out/guard', emptyOutDir: true, target: 'node24', minify: false, rollupOptions: { output: { entryFileNames: 'main.js', format: 'es' } } },
});
