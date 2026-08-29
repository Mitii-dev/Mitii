# Loop policy window bands

Shipped stall / recovery standards vary by **effective context window**.

## Where to edit (permanent)

Edit **[`loopPolicyBands.ts`](./loopPolicyBands.ts)**:

| Constant | Purpose |
|---|---|
| `LOOP_POLICY_WINDOW_BAND_CEILINGS` | Band cutoffs (`compact` &lt; 50k, `standard` &lt; 100k, else `wide`) |
| `LOOP_POLICY_WINDOW_BAND_TABLE.*.overrides` | Partial overrides on `AGENT_ENGINE_THRESHOLDS` |

Base knobs that apply to every band live in [`../policy.ts`](../policy.ts) (`AGENT_ENGINE_THRESHOLDS`).

## Merge order

```text
AGENT_ENGINE_THRESHOLDS   (base working standards)
        ↓
band overrides            (compact / standard / wide)
        ↓
lab overrides             (optional mitii.loopPolicy.* when Custom is on)
```

Runtime entry point: `resolveLoopPolicyThresholds({ contextWindowTokens, overrides? })`.

## Lab vs ship

1. Keep **Custom loop policy** off for deploy — only the band from the model window applies.
2. Turn Custom on to A/B a few knobs against the active band.
3. When a tweak wins for that band, copy it into `LOOP_POLICY_WINDOW_BAND_TABLE` and turn Custom off.

## Bands (defaults)

| Band | Window | Intent |
|---|---|---|
| `compact` | &lt; 50k | More read/retry patience; shorter recovered essays |
| `standard` | 50k – &lt; 100k | Base `AGENT_ENGINE_THRESHOLDS` as-is |
| `wide` | ≥ 100k | Same pressure as base; slightly larger recovered analysis budget |
