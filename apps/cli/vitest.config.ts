import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'src/**/*.spec.ts'],
    environment: 'node',
    // Full workspace index + status on Windows CI needs headroom beyond Vitest's 5s default.
    testTimeout: 60_000,
  },
});
