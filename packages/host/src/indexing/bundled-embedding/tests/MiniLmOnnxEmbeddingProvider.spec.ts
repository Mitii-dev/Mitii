import { describe, expect, it } from 'vitest';

import { MiniLmOnnxEmbeddingProvider } from '../adapters/MiniLmOnnxEmbeddingProvider.js';
import { bundledEmbeddingProfile } from '../index.js';
import type { CreatedOnnxSession, TextTokenizer } from '../contracts.js';

describe('MiniLmOnnxEmbeddingProvider', () => {
  it('mean-pools session output into the bundled profile space', async () => {
    const tokenizer: TextTokenizer = {
      encodeBatch: (texts) => ({
        inputIds: texts.map(() => [1, 2, 0]),
        attentionMask: texts.map(() => [1, 1, 0]),
        tokenTypeIds: texts.map(() => [0, 0, 0]),
        sequenceLength: 3,
      }),
    };
    const runtime: CreatedOnnxSession = {
      resolution: {
        schemaVersion: 1,
        status: 'ready',
        kind: 'native',
        packageId: 'onnxruntime-node',
        platform: 'darwin',
        arch: 'arm64',
        reasonCode: 'native',
      },
      createInt64Tensor: (values, dims) => ({ values, dims }),
      session: {
        inputNames: ['input_ids', 'attention_mask', 'token_type_ids'],
        outputNames: ['last_hidden_state'],
        async run() {
          return {
            last_hidden_state: {
              data: [3, 4, 0, 0, 9, 9],
              dims: [1, 3, 2],
            },
          };
        },
      },
    };

    const provider = new MiniLmOnnxEmbeddingProvider(
      runtime,
      tokenizer,
      bundledEmbeddingProfile(),
    );
    const [vector] = await provider.embed(['hello']);
    expect(provider.profile.id).toBe('bundled:all-MiniLM-L6-v2:384:normalized');
    expect(vector[0]).toBeCloseTo(0.6);
    expect(vector[1]).toBeCloseTo(0.8);
  });
});
