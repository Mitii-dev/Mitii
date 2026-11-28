# runtime/tools

Grant enforcement and model tool surface. Catalog / adapters move here as
`engine/tool-runtime` evacuates.

**Owned here:**
- `toModelToolSurface(grant)` — prompt tools ⊆ grant
- `checkToolAgainstGrant` — exact deny reasons (`tool_not_allowed`, …)
- Deny reason catalog (`GRANT_DENY_REASONS`)

**Non-responsibilities:** decision-policy plates, host UI, OS sandbox.
