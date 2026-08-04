import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';

// Composition-root build config. The renderer (src/ui) and domain (src/core) carry no
// build-time coupling to this harness. WO-0007 wraps it in the Electron shell: the
// main + preload scripts are built from electron/ alongside the renderer. The renderer
// entry stays src/renderer/index.tsx; only electron/{main,preload}.ts import an adapter.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: {
        input: 'electron/preload.ts',
        // Sandboxed preloads run without an ESM context (Electron docs), so the preload
        // must be CommonJS. The plugin's ESM-project default emits CJS content under a
        // .mjs suffix — force a deterministic .cjs output to remove that ambiguity.
        vite: {
          build: {
            rolldownOptions: { output: { format: 'cjs', entryFileNames: 'preload.cjs' } },
          },
        },
      },
    }),
  ],
});
