import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    vscode: resolve(__dirname, 'tests/vscode.ts'),
    '@mitii/live-token-budget': resolve(__dirname, '../src/liveTokenBudgetPreview.ts'),
    '@mitii/v8': resolve(__dirname, '../../../packages/v8/src/index.ts'),
    '@mitii/sdk': resolve(__dirname, '../../../packages/sdk/src/index.ts'),
    '@mitii/host': resolve(__dirname, '../../../packages/host/src/index.ts'),
    '@mitii/search-kit': resolve(__dirname, '../../../packages/search-kit/src/index.ts'),
  } },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx'],
    setupFiles: ['../../../vitest.setup.ts'],
    testTimeout: 30000,
  },
});
