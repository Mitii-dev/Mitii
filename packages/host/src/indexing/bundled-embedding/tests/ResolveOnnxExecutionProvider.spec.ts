import { describe, expect, it } from 'vitest';

import {
  resolveOnnxNativeTarget,
  unsupportedOnnxPlatform,
} from '../actions/ResolveOnnxExecutionProvider.js';
import { ONNX_NATIVE_TARGETS } from '../constants.js';

describe('ONNX native targets', () => {
  it('registers linux, macOS, and Windows x64/arm64', () => {
    expect(ONNX_NATIVE_TARGETS).toEqual(
      expect.arrayContaining([
        { platform: 'darwin', arch: 'arm64' },
        { platform: 'darwin', arch: 'x64' },
        { platform: 'linux', arch: 'x64' },
        { platform: 'linux', arch: 'arm64' },
        { platform: 'win32', arch: 'x64' },
        { platform: 'win32', arch: 'arm64' },
      ]),
    );
  });

  it('resolves the current process target when it is registered', () => {
    const target = resolveOnnxNativeTarget('linux', 'arm64');
    expect(target).toEqual({ platform: 'linux', arch: 'arm64' });
    expect(unsupportedOnnxPlatform('sunos', 'sparc').reasonCode).toBe(
      'unsupported_platform',
    );
  });
});
