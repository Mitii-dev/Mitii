import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  base: './',
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
