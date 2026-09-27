import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';

// v2 build config. Three targets: the composition root (electron/main.ts), its bridge
// (electron/preload.ts) and the renderer (index.html → src/presentation/root.tsx). In dev the
// plugin builds main + preload, starts Electron and exports the Vite server URL as
// ELECTRON_RENDERER_URL, which main.ts loads; in build the renderer lands in dist/ and main
// serves it from disk.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: {
        input: 'electron/preload.ts',
        // Sandboxed preloads run without an ESM context (Electron docs), so the preload must be
        // CommonJS. The plugin's ESM-project default emits CJS content under a .mjs suffix —
        // force a deterministic .cjs output to remove that ambiguity.
        vite: {
          build: {
            rolldownOptions: { output: { format: 'cjs', entryFileNames: 'preload.cjs' } },
          },
        },
      },
    }),
  ],
});
