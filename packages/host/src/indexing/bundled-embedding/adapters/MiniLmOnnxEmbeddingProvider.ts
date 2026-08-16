import type { EmbeddingProfile, EmbeddingProvider } from '@mitii/v8';

import { meanPoolAndNormalize } from '../actions/MeanPoolAndNormalize.js';
import { BUNDLED_MINILM_CATALOG } from '../catalog.js';
import type {
  CreatedOnnxSession,
  OnnxTensorLike,
  TextTokenizer,
} from '../contracts.js';

function flatten(rows: number[][]): number[] {
  const values: number[] = [];
  for (const row of rows) {
    values.push(...row);
  }
  return values;
}

function firstOutput(
  outputs: Record<string, OnnxTensorLike>,
  names: readonly string[],
): OnnxTensorLike {
  for (const name of ['last_hidden_state', 'token_embeddings', ...names]) {
    if (outputs[name]) {
      return outputs[name];
    }
  }
  const first = Object.values(outputs)[0];
  if (!first) {
    throw new Error('MiniLM ONNX session returned no tensors.');
  }
  return first;
}

export class MiniLmOnnxEmbeddingProvider implements EmbeddingProvider {
  readonly profile: EmbeddingProfile;

  constructor(
    private readonly runtime: CreatedOnnxSession,
    private readonly tokenizer: TextTokenizer,
    profile: EmbeddingProfile,
    private readonly options: {
      maxSequenceLength?: number;
      hiddenSize?: number;
    } = {},
  ) {
    this.profile = profile;
  }

  async embed(
    texts: readonly string[],
    context?: { abortSignal?: AbortSignal },
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    context?.abortSignal?.throwIfAborted();
    const maxLength =
      this.options.maxSequenceLength ?? BUNDLED_MINILM_CATALOG.maxSequenceLength;
    const batch = this.tokenizer.encodeBatch(texts, { maxLength });
    const dims = [batch.inputIds.length, batch.sequenceLength] as const;
    const feeds: Record<string, unknown> = {};
    const names = new Set(this.runtime.session.inputNames);
    if (names.has('input_ids') || names.size === 0) {
      feeds.input_ids = this.runtime.createInt64Tensor(
        flatten(batch.inputIds),
        dims,
      );
    }
    if (names.has('attention_mask') || names.size === 0) {
      feeds.attention_mask = this.runtime.createInt64Tensor(
        flatten(batch.attentionMask),
        dims,
      );
    }
    if (names.has('token_type_ids')) {
      feeds.token_type_ids = this.runtime.createInt64Tensor(
        flatten(batch.tokenTypeIds),
        dims,
      );
    }

    const outputs = await this.runtime.session.run(feeds);
    const hidden = firstOutput(outputs, this.runtime.session.outputNames);
    const hiddenDims =
      hidden.dims.length === 3
        ? hidden.dims
        : [
            batch.inputIds.length,
            batch.sequenceLength,
            this.options.hiddenSize ?? BUNDLED_MINILM_CATALOG.hiddenSize,
          ];
    return meanPoolAndNormalize({
      hiddenState: hidden.data,
      dims: hiddenDims,
      attentionMasks: batch.attentionMask,
      normalize: this.profile.normalized,
    });
  }
}
