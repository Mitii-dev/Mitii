# Budgets

Run-budget and loop-window helpers: clamp host budgets against Window Policy,
estimate loop input token budget, and surface exploration re-read signals.

## Owns
- `clampRunBudget` (soft/hard ceilings)
- `calculateLoopInputBudgetTokens`
- `toRunUsage` / `applyExplorationSignal`

## Does not own
- Window Policy derivation (→ `modules/window-budget`)
- Loop-file-read thrash detection (→ `helpers/loop-rails/loop-file-reads`)
- Threshold tables (→ engine legacy policy / loop bands)

Also owns wall-time wrap-up reserve, turn output clamp, and prompt-cache class.
