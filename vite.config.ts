import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Composition-root build config. The renderer (src/ui) and domain (src/core) carry no
// build-time coupling to this harness; M2 swaps it for the Electron shell.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
