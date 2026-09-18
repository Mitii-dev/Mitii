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

  it('falls back to WASM when native InferenceSession.create throws', async () => {
    const modelPath = join(tmpdir(), 'mitii-fallback-minilm.onnx');
    let wasmCreateCalls = 0;
    const factory = new HostOnnxRuntimeSessionFactory((packageId) => {
      if (packageId === 'onnxruntime-node') {
        return {
          Tensor: class {
            constructor() {}
          } as never,
          InferenceSession: {
            create: async () => {
              throw new Error('NODE_MODULE_VERSION mismatch');
            },
          },
        };
      }
      if (packageId === 'onnxruntime-web') {
        return {
          Tensor: class {
            constructor() {}
          } as never,
          InferenceSession: {
            create: async () => {
              wasmCreateCalls += 1;
              return {
                inputNames: ['input_ids'],
                outputNames: ['last_hidden_state'],
                run: async () => ({}),
              };
            },
          },
          env: { wasm: {} },
        };
      }
      return undefined;
    });

    // Force native-first so the create() throw path is exercised, then WASM.
    const created = await factory.create({
      modelPath,
      preferredKind: 'native',
    });
    expect(wasmCreateCalls).toBe(1);
    expect(created.resolution.kind).toBe('wasm');
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
