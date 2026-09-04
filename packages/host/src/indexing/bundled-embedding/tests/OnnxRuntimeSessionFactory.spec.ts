import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  HostOnnxRuntimeSessionFactory,
  resolvePreferredOnnxKind,
} from '../adapters/OnnxRuntimeSessionFactory.js';

describe('HostOnnxRuntimeSessionFactory', () => {
  it('loads native onnxruntime-node or WASM fallback on this machine', async () => {
    const factory = new HostOnnxRuntimeSessionFactory();
    await expect(
      factory.create({
        modelPath: join(tmpdir(), 'mitii-missing-minilm.onnx'),
      }),
    ).rejects.toThrow(/onnx|no such file|not exist|FILE|PROTOBUF|unavailable/i);
  });
});

describe('resolvePreferredOnnxKind', () => {
  it('prefers WASM on plain Node to avoid native ORT teardown aborts', () => {
    expect(resolvePreferredOnnxKind(undefined, {}, {})).toBe('wasm');
  });

  it('keeps native-first under Electron when unset', () => {
    expect(
      resolvePreferredOnnxKind(
        undefined,
        {},
        { electron: '37.0.0' } as NodeJS.ProcessVersions,
      ),
    ).toBeUndefined();
  });

  it('honors explicit preferredKind and MITII_ONNX_KIND', () => {
    expect(
      resolvePreferredOnnxKind('native', { MITII_ONNX_KIND: 'wasm' }, {}),
    ).toBe('native');
    expect(
      resolvePreferredOnnxKind(undefined, { MITII_ONNX_KIND: 'native' }, {}),
    ).toBe('native');
    expect(
      resolvePreferredOnnxKind(
        undefined,
        { MITII_ONNX_KIND: 'wasm' },
        { electron: '37.0.0' } as NodeJS.ProcessVersions,
      ),
    ).toBe('wasm');
  });
});
