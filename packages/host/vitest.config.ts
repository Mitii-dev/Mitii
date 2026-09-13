import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@mitii/v8': resolve(__dirname, '../v8/src/index.ts'),
      '@mitii/sdk': resolve(__dirname, '../sdk/src/index.ts'),
      '@mitii/automation': resolve(__dirname, '../automation/src/index.ts'),
      '@mitii/search-kit': resolve(__dirname, '../search-kit/src/index.ts'),
      '@mitii/mcp': resolve(__dirname, '../mcp/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
