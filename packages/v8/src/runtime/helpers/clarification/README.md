# Clarification

UI-safe clarification payload + session for ask-slot / intent ambiguity.

## Owns
- `buildClarificationPayload` (question + options + session)
- `resolveClarificationAnswer` / `amendMessageWithClarification`

## Does not own
- Plan-scope clarify drafts (plan-discovery)
- Gate suspend orchestration
