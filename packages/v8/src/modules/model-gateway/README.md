# Model Gateway

```text
Input:  ModelRequest
Output: AsyncIterable<ModelEvent>
```

Provider-neutral LLM boundary. Declares `LlmPort`, validates requests and
capabilities, and ships module-owned adapters for supported providers.

Provider selection, retries, model routing, prompt budgeting, and tool
execution remain Engine responsibilities.

When `LlmPort.countTokens` is unavailable, the prompt-budget module must use
an injected token estimator.

## Public API

| Export | Role |
|--------|------|
| `LlmPort` | Provider-neutral streaming contract |
| `ModelEvent` | Discriminated stream events |
| `ModelCapabilityResolver` | Normalize declared capabilities |
| `EchoLlmPort` | Offline/test adapter |
| `OpenAiCompatibleLlmPort` | OpenAI-compatible chat completions |
| `MODEL_PROVIDER_SUPPORT` | Explicit supported/unsupported matrix |

```ts
const port = new OpenAiCompatibleLlmPort({
  baseUrl: "http://localhost:11434/v1",
  model: "llama3.2",
});

for await (const event of port.complete({
  messages: [{ role: "user", content: "Hello" }],
})) {
  if (event.type === "content_delta") {
    // ...
  }
}
```

## Provider support

| Provider | Status | Adapter |
|----------|--------|---------|
| Echo | supported | `EchoLlmPort` |
| OpenAI | supported | `OpenAiCompatibleLlmPort` |
| Ollama | supported | `OpenAiCompatibleLlmPort` |
| OpenAI-compatible | supported | `OpenAiCompatibleLlmPort` |
| Anthropic | unsupported | — |
| Gemini | unsupported | — |

## Layout

```text
model-gateway/
├── contracts/          # request/event/capability schemas + types
├── adapters/
├── ModelCapabilityResolver.ts
├── constants.ts
└── index.ts
```

## Adapters

```text
adapters/
├── EchoLlmPort.ts
└── OpenAiCompatibleLlmPort.ts
```

## Do not put here

- Prompt construction or token budgeting
- Tool execution
- Host secret loading (inject `apiKey` from Application)
- Legacy `features/ce` or `adapters/providers` imports

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/model-gateway/tests
```
