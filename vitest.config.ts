import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/v8/modules/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
