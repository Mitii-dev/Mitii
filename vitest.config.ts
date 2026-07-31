import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Consumer suites exercise public entry points without requiring a prior dist build.
      '@mitii/v8': resolve(__dirname, 'packages/v8/src/index.ts'),
      '@mitii/sdk': resolve(__dirname, 'packages/sdk/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/architecture/**/*.test.ts',
      'tests/packages/**/*.test.ts',
      'tests/contract/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/e2e/**/*.test.ts',
      // Vitest-owned @mitii/v8 suites only (node:test specs stay on disk).
      'packages/v8/src/engine/**/*.spec.ts',
      'packages/v8/src/modules/decision-policy/**/*.spec.ts',
      'packages/v8/src/modules/memory/**/*.spec.ts',
      'packages/v8/src/modules/prompt-construction/**/*.spec.ts',
      'packages/v8/src/modules/skills/**/*.spec.ts',
      'packages/v8/src/modules/verification/**/*.spec.ts',
      'packages/v8/src/modules/repository-state/internal/repo-map/**/*.spec.ts',
    ],
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', 'legacy/**', 'tests/benchmark/**'],
  },
});
