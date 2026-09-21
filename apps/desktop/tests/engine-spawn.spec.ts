import { describe, expect, it } from 'vitest';

import { resolveEngineNodeBinary } from '../src/main/engine-spawn.js';

describe('resolveEngineNodeBinary', () => {
  it('uses process.execPath outside Electron', () => {
    // In vitest we are not under Electron.
    expect(resolveEngineNodeBinary()).toBe(process.execPath);
  });

  it('honors MITII_NODE_PATH override when Electron is present', () => {
    const original = process.versions.electron;
    Object.defineProperty(process.versions, 'electron', {
      value: '34.0.0',
      configurable: true,
    });
    try {
      expect(
        resolveEngineNodeBinary({ MITII_NODE_PATH: '/usr/local/bin/node' }),
      ).toBe('/usr/local/bin/node');
    } finally {
      Object.defineProperty(process.versions, 'electron', {
        value: original,
        configurable: true,
      });
    }
  });
});
