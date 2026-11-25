# Model Gateway

**Does:** provider-neutral LLM boundary — `ModelRequest` in, streaming `ModelEvent`s out — plus capability normalization. Adapters own OpenAI-compatible / Anthropic / Gemini / echo wire details. Does not build prompts, authorize tools, or run the agent loop.

## Contract

```text
ResolveModelCapabilitiesInput  →  ModelGatewayPipeline.resolveCapabilities()  →  ModelCapabilities

LlmPort + ModelRequest         →  ModelGatewayPipeline.complete()             →  AsyncIterable<ModelEvent>
```

| Surface | Role |
|---|---|
| `LlmPort` | provider port (`complete`, `capabilities`) |
| `ModelRequest` / `ModelMessage` / tools | request shape |
| `ModelEvent` | content / reasoning / tool_call deltas, usage, completed / failed / cancelled |
| Native adapters | Echo, Anthropic, Gemini |
| OpenAI-compatible | OpenAI, Azure, Ollama, LM Studio, OpenRouter, DeepSeek, **Grok/xAI**, **Groq**, **Mistral**, **Together**, **Fireworks** |

Cursor has **no** public chat-completions API — use Anthropic / OpenAI / Gemini / Grok (or Cursor Agent SDK outside this module).

## Example

```ts
const gateway = new ModelGatewayPipeline();

const capabilities = gateway.resolveCapabilities({
  modelId: "local/qwen",
  contextWindowTokens: 128_000,
  supportsTools: true,
});
// capabilities.maximumOutputTokens === 32_000  (25% default)

const port = new EchoLlmPort({ modelId: "echo/local" });
for await (const event of gateway.complete(port, {
  messages: [{ role: "user", content: "Inspect LoginForm.tsx" }],
})) {
  // content_delta → … → completed | failed | cancelled
}
```
