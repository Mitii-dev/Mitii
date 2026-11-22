import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  base: './',
  resolve: {
    alias: {
      '@mitii/ui-core': resolve(
        __dirname,
        '../../../packages/ui-core/src/index.ts',
      ),
      '@mitii/ui-react': resolve(
        __dirname,
        '../../../packages/ui-react/src/index.ts',
      ),
      '@mitii/ui-protocol': resolve(
        __dirname,
        '../../../packages/ui-protocol/src/index.ts',
      ),
    },
  },
  build: {
    outDir: resolve(__dirname, '../dist/webview'),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'main.js',
        assetFileNames: (asset) =>
          asset.name && asset.name.endsWith('.css') ? 'main.css' : 'assets/[name][extname]',
        chunkFileNames: 'chunks/[name].js',
      },
    },
  },
});
