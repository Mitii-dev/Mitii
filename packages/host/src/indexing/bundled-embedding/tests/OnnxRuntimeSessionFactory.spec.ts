import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { HostOnnxRuntimeSessionFactory } from '../adapters/OnnxRuntimeSessionFactory.js';

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
