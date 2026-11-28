# Tool serialize

Serialize tool results for the model without dumping secrets; budget file bodies
and change-impact payloads on line / node limits.

## Owns
- `serializeToolResultForModel`
- Output budgeting helpers (file / change-impact / JSON string clip)

## Does not own
- Tool execution / grant enforcement
- Compaction ladder stubs
