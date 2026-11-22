import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Renderer must stay browser-safe. Native Node addons and host/engine stacks
 * belong in main/engine processes — never bundle them into the UI.
 */
const NATIVE_EXTERNALS = [
  '@lancedb/lancedb',
  '@lancedb/lancedb-darwin-arm64',
  '@lancedb/lancedb-darwin-x64',
  '@lancedb/lancedb-linux-x64-gnu',
  '@lancedb/lancedb-linux-arm64-gnu',
  '@lancedb/lancedb-win32-x64-msvc',
  'better-sqlite3',
  'onnxruntime-node',
];

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: [
        ...NATIVE_EXTERNALS,
        /^@lancedb\//,
        /\.node$/,
      ],
    },
  },
  optimizeDeps: {
    exclude: [...NATIVE_EXTERNALS],
  },
  // Do NOT alias '../shared' — that string also matches @mitii/v8 relative
  // imports (e.g. ../shared/content-hasher) and breaks the renderer build.
  // Renderer files already reach src/shared via normal relative paths.
});
