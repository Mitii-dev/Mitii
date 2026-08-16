import {
  BUNDLED_MINILM_DIMENSIONS,
  BUNDLED_MINILM_HIDDEN_SIZE,
  BUNDLED_MINILM_ID,
  BUNDLED_MINILM_MAX_SEQUENCE_LENGTH,
  BUNDLED_MINILM_MODEL_ID,
  BUNDLED_MINILM_PROVIDER_ID,
} from './constants.js';
import type { BundledEmbeddingModelCatalog } from './contracts.js';

/**
 * On-device MiniLM catalog. Weights are downloaded once into the host model
 * cache; they are not shipped inside the VSIX.
 *
 * Checksums come from Hugging Face LFS metadata for
 * `Xenova/all-MiniLM-L6-v2` `onnx/model_quantized.onnx`. Tokenizer.json has a
 * size bound only — do not invent a content hash.
 */
export const BUNDLED_MINILM_CATALOG: BundledEmbeddingModelCatalog = {
  schemaVersion: 1,
  id: BUNDLED_MINILM_ID,
  providerId: BUNDLED_MINILM_PROVIDER_ID,
  modelId: BUNDLED_MINILM_MODEL_ID,
  dimensions: BUNDLED_MINILM_DIMENSIONS,
  hiddenSize: BUNDLED_MINILM_HIDDEN_SIZE,
  maxSequenceLength: BUNDLED_MINILM_MAX_SEQUENCE_LENGTH,
  normalized: true,
  pooling: 'mean',
  assets: {
    model: {
      fileName: 'model_quantized.onnx',
      url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx',
      sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
      bytes: 22_972_370,
    },
    tokenizer: {
      fileName: 'tokenizer.json',
      url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
      minBytes: 700_000,
      maxBytes: 730_000,
    },
  },
};
