# Preflight

Before-understand / before-mutation verification scaffolding: synthetic grant,
verification input, target/scope derivation, and whether Agent mode should
capture an unconditional preflight snapshot.

## Owns
- `buildPreflightVerificationInput` / `derivePreflightTargets` / project resolve
- Diagnostic summary helpers for preflight
- `shouldCaptureUnconditionalAgentPreflight`

## Does not own
- Preflight repair lock / user-path priority (→ `helpers/user-path-priority`)
- Preflight diagnostic repair instruction (→ `helpers/verify`)
- Running verification (pipeline / verify phase)
