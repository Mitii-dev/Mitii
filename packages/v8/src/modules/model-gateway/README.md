# Model Gateway

The universal plug for language models: one request shape in, one stream of events out, whatever the provider.

## Does
- Normalizes model capabilities (context window, tools support, output ceiling).
- Streams a provider-neutral `ModelRequest` through an injected `LlmPort` as `ModelEvent`s.
- Ships adapters for Echo (tests), Anthropic, Gemini, and OpenAI-compatible endpoints (OpenAI, Azure, Ollama, LM Studio, OpenRouter, DeepSeek, Grok/xAI, Groq, Mistral, Together, Fireworks).

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `ResolveModelCapabilitiesInput` for capabilities; `LlmPort` + `ModelRequest` (messages, tools, limits) for completion.
**Output:** `ModelCapabilities`; or an `AsyncIterable<ModelEvent>` (content / reasoning / tool-call deltas, usage, then `completed` | `failed` | `cancelled`).
**Pipeline:** `ModelGatewayPipeline` stages: `1-resolve-capabilities` → `2-complete`
**Ports we offer / need:** offers `LlmPort` (`complete`, `capabilities`); adapters (`EchoLlmPort`, `AnthropicLlmPort`, `GeminiLlmPort`, `OpenAiCompatibleLlmPort`) fulfill it. Optional `ModuleLoggerPort`.

## Dependencies
**Upstream (this module uses):** none.
**Downstream (who uses this):** planning, prompt-construction, request-understanding, and the engine (model calls, composition).

## How to use
```ts
import { ModelGatewayPipeline, EchoLlmPort } from "@mitii/v8/modules/model-gateway";

const gateway = new ModelGatewayPipeline();
const capabilities = gateway.resolveCapabilities({ modelId: "local/qwen", contextWindowTokens: 128_000, supportsTools: true });
for await (const event of gateway.complete(new EchoLlmPort({ modelId: "echo/local" }), request)) { /* … */ }
```

## Example
Input:
```json
{ "modelId": "local/qwen", "contextWindowTokens": 128000, "supportsTools": true }
```
Output (illustrative, abbreviated):
```json
{ "modelId": "local/qwen", "contextWindowTokens": 128000, "supportsTools": true, "maximumOutputTokens": 32000 }
```

## Non-responsibilities
Does not build prompts, authorize tools, or run the agent loop. Cursor has no public chat-completions API, so it is not a provider here.
