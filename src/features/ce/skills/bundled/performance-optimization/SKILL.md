---
name: performance-optimization
description: Measure-first performance optimization for regressions, Core Web Vitals, and load budgets. Use when profiling shows a bottleneck; not for speculative premature optimization.
---

# Performance Optimization

## Quick Reference

- Measure → Identify → Fix → Verify → Guard. Never optimize without a baseline.
- Fix the proven bottleneck only; re-measure after the change.
- Prefer budgets (CWV, p95, bundle size) and CI guardrails.
- Deep checklist: `references/performance-checklist.md`.
- Boundary vs `react-next-performance`: this skill = general/measure-first across FE/BE; react-next = React/Next-specific rule routing when the stack and symptom are React/Next.

## When to Use / Not

**Use when:** SLA/budget exists; users/monitoring report slowness; CWV below target; suspected regression; large-data/high-traffic features with evidence.

**Do not use when:** no measured problem (premature optimization); pure React/Next rule application with an already-known React symptom — prefer `react-next-performance` for that stack’s specific rules after measuring.

## Core Web Vitals (Good)

| Metric | Good |
| --- | --- |
| LCP | ≤ 2.5s |
| INP | ≤ 200ms |
| CLS | ≤ 0.1 |

## Workflow

### 1. Measure

Establish baseline with synthetic (Lighthouse, DevTools Performance) and/or RUM (web-vitals, CrUX). Backend: APM, query timing, `console.time` around suspects.

Symptom → first measurement:

- First load → bundle size, TTFB waterfall, render-blocking resources
- Sluggish interaction → long tasks (>50ms), re-renders
- Post-navigation → API waterfalls, client render time
- Backend → query plans/indexes, pool/CPU/memory, locks/GC

### 2. Identify

Common signals:

| Area | Symptom | Investigate |
| --- | --- | --- |
| FE | Slow LCP / high CLS / poor INP / large load | Images, blocking CSS/JS, layout shifts, long tasks, bundle |
| BE | Slow API / memory growth / CPU spikes | N+1, missing indexes, unbounded fetch, leaks, sync heavy work |

### 3. Fix (proven bottleneck only)

Apply the smallest fix matching evidence. Typical patterns (details in checklist):

- N+1 → join/include/batch
- Unbounded lists → pagination/limits
- Images → dimensions, modern formats, priority/lazy correctly
- Re-renders → stable props, memo only where measured
- Bundle → route-level lazy/Suspense for heavy rarely-used paths
- Caching → TTL for hot reads; Cache-Control for static/API as appropriate

Do not combine unrelated FE/BE/bundle refactors unless evidence connects them.

### 4. Verify

Re-run the same measurement; record before/after numbers.

### 5. Guard

Add budget/CI checks (bundlesize, Lighthouse CI) or a regression test/monitor when practical.

## Budgets (defaults — adjust to project)

- JS initial: < 200KB gzipped; CSS < 50KB; above-fold image < 200KB; fonts < 100KB total
- API p95 < 200ms; Lighthouse Performance ≥ 90 when used

## Ask Guidance

- Stay read-only; report baseline, bottleneck hypothesis with evidence, and recommended fix options.
- Distinguish measured facts from speculative causes.

## Planning Guidance

- Require a measurement step before implementation.
- One bottleneck per vertical slice; include re-measure and guardrail steps.
- If stack is React/Next and rules are framework-specific, plan handoff/use of `react-next-performance` for the fix details.

## Agent Execution Guidance

- Capture baseline before edits.
- Change one bottleneck at a time; keep behavior tests green.
- Prefer low-risk measurable fixes over broad rewrites.
- Stop after requested performance goal is verified — no drive-by cleanup.

## Verification Guidance

- Before/after numbers for the targeted metric
- Bottleneck identified and addressed
- Focused tests/build still pass
- Budget/CI check when configured; report if measurement tools unavailable

## Failure Behavior

- No reproducible slow path → stop; ask for repro, trace, or RUM evidence.
- Fix does not improve metric → revert speculative change; re-profile before next attempt.
- Measurement tools missing → use best available proxy and state the limitation.

## Forbidden Actions

- Optimizing without a baseline
- Claiming improvement without re-measurement
- Broad speculative rewrites “for performance”
- Breaking correctness/accessibility for micro-gains
- Expanding into unrelated refactors after the budget is met
