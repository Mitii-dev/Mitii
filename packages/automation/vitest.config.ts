import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/tests/**/*.spec.ts'],
    testTimeout: 30_000,
  },
});
