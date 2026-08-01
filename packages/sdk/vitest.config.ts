import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve @mitii/v8 to source so SDK tests do not require a prior dist build.
 * Package consumers still load `@mitii/v8` via package exports (dist).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@mitii/v8': resolve(packageRoot, '../v8/src/index.ts'),
      '@mitii/sdk': resolve(packageRoot, 'src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
});
