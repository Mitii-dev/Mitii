import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
  // Do NOT alias '../shared' — that string also matches @mitii/v8 relative
  // imports (e.g. ../shared/content-hasher) and breaks the renderer build.
  // Renderer files already reach src/shared via normal relative paths.
});
