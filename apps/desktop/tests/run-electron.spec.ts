import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createElectronEnv } = require('../scripts/run-electron.cjs') as {
  createElectronEnv: (env?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
};

describe('run-electron', () => {
  it('removes ELECTRON_RUN_AS_NODE so Electron can open a BrowserWindow', () => {
    const env = createElectronEnv({
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
      FOO: 'bar',
    });

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.FOO).toBe('bar');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('leaves an already-clean env unchanged aside from copying', () => {
    const env = createElectronEnv({ PATH: '/bin', HOME: '/tmp' });
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    expect(env.HOME).toBe('/tmp');
  });
});
