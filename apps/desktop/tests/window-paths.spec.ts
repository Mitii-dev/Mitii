import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  resolvePreloadPath,
  resolveRendererHtml,
} from '../src/main/window.js';

describe('window path resolution', () => {
  it('points preload at the sandbox-safe CJS bundle', () => {
    expect(resolvePreloadPath('/app/dist')).toBe(
      join('/app/dist', 'preload', 'index.cjs'),
    );
  });

  it('points renderer at Vite index.html', () => {
    expect(resolveRendererHtml('/app/dist')).toBe(
      join('/app/dist', 'renderer', 'index.html'),
    );
  });
});
