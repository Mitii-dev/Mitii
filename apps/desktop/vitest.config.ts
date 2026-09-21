import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@mitii/sdk': resolve(__dirname, '../../packages/sdk/src/index.ts'),
      '@mitii/host': resolve(__dirname, '../../packages/host/src/index.ts'),
      '@mitii/mcp': resolve(__dirname, '../../packages/mcp/src/index.ts'),
      '@mitii/v8': resolve(__dirname, '../../packages/v8/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
});
