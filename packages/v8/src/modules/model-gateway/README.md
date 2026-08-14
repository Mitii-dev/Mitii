# Model Gateway

Model Gateway is the provider-neutral LLM boundary. It lets Agent Engine and Prompt Construction work with one `LlmPort` contract while provider adapters handle OpenAI-compatible, Anthropic, Gemini, or echo-model details.

## What This Module Does

- Defines `ModelRequest`, `ModelMessage`, model tool definitions, and model events.
- Defines `LlmPort` for streaming completions and capability resolution.
- Normalizes provider responses into `ModelEvent`.
- Normalizes provider failures into `ModelError`.
- Resolves model capabilities such as context window, tool support, streaming, reasoning, vision, and structured output.

## Structure

```text
model-gateway/
  contracts/                ModelRequest, ModelEvent, ModelCapabilities, LlmPort
  adapters/                 Echo, OpenAI-compatible, Anthropic, Gemini
  internal/                 HTTP and SSE helpers
  ModelCapabilityResolver.ts
  constants.ts
  tests/
```

## Types And Contracts

- `ModelRequest`: messages, model options, maximum output tokens, stream flag, tools, tool choice, reasoning, and response format.
- `ModelMessage`: system/user/assistant/tool content with optional tool calls or image attachments.
- `ModelToolDefinition`: name, description, and input schema.
- `ModelEvent`: content deltas, reasoning deltas, tool-call deltas, usage, completed, failed, or cancelled.
- `ModelCapabilities`: provider/model feature contract.
- `LlmPort`: provider interface used by Agent Engine.

## Technical Details

- `EchoLlmPort` is deterministic and useful for tests.
- `OpenAiCompatibleLlmPort` maps V8 requests to OpenAI-compatible APIs.
- `AnthropicLlmPort` and `GeminiLlmPort` adapt provider-specific formats.
- `ModelCapabilityResolver` fills defaults and validates output/context constraints.
- Tool calls stream as `tool_call_delta` events and are executed later by Agent Engine through Tool Runtime.
- Provider errors include retryability and optional retry delay.

## Ownership Boundaries

Owns model contracts, provider adapters, capability normalization, and event normalization.

Does not own prompt construction, authorization, tool execution, repository context, or run orchestration policy.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/model-gateway
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

ModelRequest -> AsyncIterable<ModelEvent>:

```json
{
  "prompt": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "workspaceId": "workspace-1",
  "stateToken": "state-abc",
  "targetFile": "src/LoginForm.tsx"
}
```

### Step-By-Step Flow

1. A user sends the real prompt shown above from an editor or chat host.
2. The host attaches workspace id `workspace-1` and the explicit target file `src/LoginForm.tsx`.
3. The module receives the real structure shown in the input block.
4. The module validates schema/version/limits before doing any work.
5. The module extracts the important target: `src/LoginForm.tsx`.
6. The module keeps the user constraint: existing validation and error handling must stay intact.
7. The module performs only its own responsibility and does not cross into neighboring modules.
8. Any budget, path, state, or provider constraint is applied before output is produced.
9. The module records warnings/reason codes instead of hiding degraded behavior.
10. The module returns the realistic output shape shown below.
11. The next pipeline stage consumes that output without reinterpreting raw user text.

### Realistic Output

Model Gateway normalized event stream returns a result like this:

```json
[
  { "type": "content_delta", "content": "I will inspect LoginForm first." },
  { "type": "tool_call_delta", "toolCalls": [{ "index": 0, "id": "call-read-login", "name": "read_file", "arguments": "{\"path\":\"src/LoginForm.tsx\"}" }] },
  { "type": "usage", "usage": { "inputTokens": 8120, "outputTokens": 140 } },
  { "type": "completed", "finishReason": "tool_calls", "usage": { "totalTokens": 8260 } }
]
```
