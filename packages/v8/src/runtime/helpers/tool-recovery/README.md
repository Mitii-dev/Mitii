# Tool recovery

Host-facing tool-call summaries, rejected-tool / rejected-mutation recovery
nudges, and recovery of tool calls leaked as markup in assistant text.

## Owns
- `summarizeToolCall`
- Rejected mutation / tool recovery messages + targeted-discovery gating
- `recoverLeakedToolCallsFromMarkup`

## Does not own
- Tool execution / grant enforcement
- Soft tool-loop guard (loop-rails)
- Leak *detection* for incomplete turns (→ `helpers/loop-turn`)
