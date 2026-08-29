export const BUNDLED_EMBEDDING_SCHEMA_VERSION = 1 as const;

export const BUNDLED_MINILM_ID = 'all-minilm-l6-v2';
export const BUNDLED_MINILM_MODEL_ID = 'all-MiniLM-L6-v2';
export const BUNDLED_MINILM_PROVIDER_ID = 'bundled';
export const BUNDLED_MINILM_DIMENSIONS = 384;
export const BUNDLED_MINILM_MAX_SEQUENCE_LENGTH = 256;
export const BUNDLED_MINILM_HIDDEN_SIZE = 384;

export const ONNX_RUNTIME_NODE_PACKAGE = 'onnxruntime-node';
export const ONNX_RUNTIME_WEB_PACKAGE = 'onnxruntime-web';
export const ONNX_RUNTIME_COMMON_PACKAGE = 'onnxruntime-common';

export const ONNX_NATIVE_TARGETS = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'linux', arch: 'arm64' },
  { platform: 'win32', arch: 'x64' },
  { platform: 'win32', arch: 'arm64' },
] as const;

export const EMBEDDING_SOURCE_REASON_CODES = {
  requested_disabled: 'requested_disabled',
  source_disabled: 'source_disabled',
  source_explicit: 'source_explicit',
  backend_explicit: 'backend_explicit',
  auto_explicit_model_ollama: 'auto_explicit_model_ollama',
  auto_explicit_model_openai: 'auto_explicit_model_openai',
  default_bundled: 'default_bundled',
} as const;

export const BUNDLED_MODEL_REASON_CODES = {
  ready: 'ready',
  download_failed: 'download_failed',
  checksum_mismatch: 'checksum_mismatch',
  size_mismatch: 'size_mismatch',
  missing_asset: 'missing_asset',
  invalid_tokenizer: 'invalid_tokenizer',
} as const;

export const ONNX_RUNTIME_REASON_CODES = {
  native: 'native',
  wasm: 'wasm',
  unavailable: 'unavailable',
  unsupported_platform: 'unsupported_platform',
} as const;
