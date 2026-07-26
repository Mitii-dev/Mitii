---
name: react-next-performance
description: Optimize React and Next.js apps using targeted performance rules. Use for render churn, data-fetch waterfalls, bundle size, hydration, Server Components, and Core Web Vitals; not for non-React backends.
---

# React Next Performance

## Quick Reference

- Diagnose the performance symptom first: waterfall, bundle, server work, client fetch, rerender, hydration, or generic JavaScript hot path.
- Read only the rule files that match the symptom.
- Prefer measurable, low-risk changes over broad rewrites.
- Keep React correctness intact: hooks rules, server/client boundaries, serialization, and accessibility still apply.
- Verify with focused tests, typecheck, build, bundle/profile output, or before/after measurements.

## Scope

Use this skill for React or Next.js performance work, including slow page loads, Core Web Vitals, render churn, hydration issues, RSC serialization, client/server data fetching, and bundle-size problems.

Do not use this skill for non-React backend performance, generic frontend design, component API design without a performance symptom, or speculative optimization with no evidence.

## Procedure

1. Establish the symptom and baseline: user report, failing budget, profiler trace, bundle report, test, or reproducible slow interaction.
2. Inspect the affected React/Next files and framework conventions: routing mode, Server Components, client boundaries, data fetching, and build tooling.
3. Pick the smallest relevant category below and read its rules from `references/rules/`.
4. Apply one focused fix at a time. Do not combine bundle, rendering, and data-fetch refactors unless the evidence connects them.
5. Re-run the baseline check or the closest available proxy. Record before/after results when measurable.

## Rule Routing

- Data waterfalls and async work: rule files whose names start with `async-`
- Bundle size and code splitting: rule files whose names start with `bundle-`
- Server Components, SSR, and server actions: rule files whose names start with `server-`
- Client data fetching and browser listeners: rule files whose names start with `client-`
- Rerender reduction and hooks dependencies: rule files whose names start with `rerender-`
- Hydration, rendering, scripts, SVG, and resource hints: rule files whose names start with `rendering-`
- Generic JavaScript hot paths: rule files whose names start with `js-`
- Advanced callback/effect patterns: rule files whose names start with `advanced-`

Use `references/rules/_sections.md` as the compact index when the symptom maps to more than one category.

## Verification

- For Next.js apps, prefer the repository build plus route-specific smoke checks.
- For render changes, run component tests and inspect profiler/render counts when available.
- For bundle changes, compare bundle analyzer or build output.
- For Core Web Vitals, compare Lighthouse/trace/RUM proxy metrics where available.

## Completion

Finish when the measured or proxied symptom improves, no React/Next boundary rules are violated, focused verification passes, and any unavailable measurement is reported clearly.
