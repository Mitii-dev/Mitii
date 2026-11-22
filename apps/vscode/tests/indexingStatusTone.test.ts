import { describe, expect, it } from 'vitest';

import type { IndexStatusSnapshot } from '../webview-ui/src/protocol.ts';
import {
  indexToneFolderColor,
  resolveIndexTone,
} from '../webview-ui/src/components/IndexingStatusBar.tsx';

function baseIndex(
  overrides: Partial<IndexStatusSnapshot> = {},
): IndexStatusSnapshot {
  return {
    fileCount: 0,
    ...overrides,
  } as IndexStatusSnapshot;
}

describe('resolveIndexTone', () => {
  it('returns idle when nothing is indexed yet', () => {
    expect(resolveIndexTone(baseIndex())).toBe('idle');
  });

  it('returns indexing (orange) while scanning', () => {
    expect(
      resolveIndexTone(
        baseIndex({ readiness: 'indexing', message: 'Indexing workspace…' }),
      ),
    ).toBe('indexing');
  });

  it('returns ready (green) when core capabilities are ready', () => {
    expect(
      resolveIndexTone(
        baseIndex({
          fileCount: 120,
          readiness: 'ready',
          capabilities: [
            { capability: 'catalog', status: 'available' },
            { capability: 'codeIndex', status: 'available' },
            { capability: 'textIndex', status: 'available' },
            { capability: 'graph', status: 'available' },
            { capability: 'map', status: 'available' },
          ],
        }),
      ),
    ).toBe('ready');
  });

  it('returns warn (red) when required capability is missing', () => {
    expect(
      resolveIndexTone(
        baseIndex({
          fileCount: 10,
          readiness: 'degraded',
          capabilities: [
            { capability: 'catalog', status: 'available' },
            { capability: 'codeIndex', status: 'unavailable' },
            { capability: 'textIndex', status: 'available' },
            { capability: 'graph', status: 'available' },
            { capability: 'map', status: 'available' },
          ],
        }),
      ),
    ).toBe('warn');
  });
});

describe('indexToneFolderColor', () => {
  it('maps tones to enterprise folder colors', () => {
    expect(indexToneFolderColor('ready')).toBe('#3ecf8e');
    expect(indexToneFolderColor('indexing')).toBe('#f0a020');
    expect(indexToneFolderColor('warn')).toBe('#ef5f67');
    expect(indexToneFolderColor('idle')).toBe('muted');
  });
});
