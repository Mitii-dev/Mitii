# Policy Admin (HTML)

Beta house for Mitii **ship** window bands (compact / standard / wide).
Live context-token budgeting, free capacity, and per-knob help with example prompts.

## Run

```bash
pnpm policy-admin
```

Opens [http://127.0.0.1:8787](http://127.0.0.1:8787). Reads V8 TypeScript sources directly (no build required to edit).

## What you get

- **Context token budget bar** — output, tools, repository, conversation, plan, skills, and **Free**
- **Live percentages** that update as you move shares / output ratio
- **Help drawer** on every knob — why, analogy, raise/lower, concrete example, example prompt
- **Loop / stall** + **window budget** ship overlays per band

## Workflow

1. Pick Compact / Standard / Wide
2. Adjust preview window if needed
3. Tune knobs (Reset clears an override back to base)
4. **Save to ship code**
5. Rebuild: `pnpm --filter @mitii/v8 build`

Empty **Standard** overrides means “use base defaults” — intentional.

## Notes

- Module shares are of *usable input* and need not total 100%. Leftover is Free.
- VS Code Developer Custom toggles are local-only; this tool owns permanent ship values.
- Port: `POLICY_ADMIN_PORT` (default `8787`).
