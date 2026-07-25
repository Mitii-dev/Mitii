# Model Gateway

```text
Input:  ModelRequest
Output: AsyncIterable<ModelResponseDelta>
```

This module defines the provider-neutral LLM boundary and normalizes declared
model capabilities. Provider selection, retries, model routing, prompt
budgeting, and tool execution remain Engine responsibilities.

When `LlmPort.countTokens` is unavailable, the future prompt-budget module must
use an injected token estimator.
