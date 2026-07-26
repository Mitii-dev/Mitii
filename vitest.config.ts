import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      // Phase 16 thin-hold — full tests/ layout is Phase 14
      'test/architecture/**/*.test.ts',
      // Vitest-owned @mitii/v8 suites only (node:test specs stay on disk).
      'packages/v8/src/engine/**/*.spec.ts',
      'packages/v8/src/modules/decision-policy/**/*.spec.ts',
      'packages/v8/src/modules/memory/**/*.spec.ts',
      'packages/v8/src/modules/prompt-construction/**/*.spec.ts',
      'packages/v8/src/modules/skills/**/*.spec.ts',
      'packages/v8/src/modules/verification/**/*.spec.ts',
    ],
    setupFiles: ['./test/setup.ts'],
    exclude: ['**/node_modules/**', 'legacy/**', 'benchmark/**'],
  },
});
