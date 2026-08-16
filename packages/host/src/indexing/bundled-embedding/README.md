# Bundled Embedding

Host-owned on-device embedding source for semantic indexing. It produces V8 `EmbeddingProvider` vectors without calling the chat-model provider.

LanceDB remains the vector **store**. This module is an embedding **source**.

## Responsibility

Turn repository chunks into 384-d L2-normalized MiniLM vectors on the local machine, using native ONNX Runtime when the OS/CPU is supported and WASM when it is not.

## Input

Validated `EmbeddingSourceResolutionInput`:

- `requestedEnabled`
- optional `source` (`bundled` | `ollama` | `openai-compatible` | `disabled`)
- optional legacy `backend` (`auto` | same values as `source`)
- chat `baseUrl` (used only to resolve legacy `auto`)
- whether an embedding model was explicitly configured

## Output

- `EmbeddingSourceResolution` (enabled source + model/dims, or disabled + reason code)
- `EmbeddingProvider` whose profile id is `bundled:all-MiniLM-L6-v2:384:normalized`

## Pipeline stages

1. Resolve embedding source (independent of Anthropic / Gemini / Ollama chat).
2. Download MiniLM ONNX + tokenizer once into `~/.mitii/models/all-minilm-l6-v2`.
3. Load ONNX Runtime: `onnxruntime-node` native first, `onnxruntime-web` WASM fallback.
4. WordPiece tokenize, mean-pool last hidden state, L2 normalize.

## Dependencies and ports

- V8 `EmbeddingProvider` contract (no V8 ONNX/host imports)
- Optional native: `onnxruntime-node` for darwin/linux/win32 x64 and arm64
- Optional WASM: `onnxruntime-web`
- Hugging Face catalog URLs for weights (not shipped in the VSIX)

## Public exports

- `resolveEmbeddingSource`
- `createBundledMiniLmEmbeddingProvider`
- `defaultBundledModelsDirectory`
- `BUNDLED_MINILM_CATALOG` / `BUNDLED_MINILM_PRESET`
- source schemas and reason codes

## Failure modes

- `requested_disabled` / `source_disabled`
- model download size or sha256 mismatch
- ONNX Runtime missing for the current platform (native and WASM)
- tokenizer.json missing a WordPiece vocabulary

Indexing then stays lexical. The module never silently projects into a different embedding space.

## Genericness

No IDE, OS path, chat provider, or programming language is hard-coded in the pooling/tokenize path. Native binaries are selected from `process.platform` + `process.arch` against a registered target list. Hosts inject download/session/tokenizer ports in tests.

## Non-responsibilities

- Vector storage (LanceDB)
- Hybrid retrieval
- Chat completions
- Shipping model weights inside the extension package
