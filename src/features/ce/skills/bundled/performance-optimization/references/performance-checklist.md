# Performance Optimization Checklist

## Measure First
- [ ] Baseline metrics captured (CWV, p95 latency, bundle size, or relevant KPI)
- [ ] Bottleneck identified with profiling/tracing — not guesses
- [ ] Success threshold defined before changing code

## Backend / API
- [ ] Eliminate N+1 and unbounded scans
- [ ] Add pagination/limits on list endpoints
- [ ] Cache only with explicit invalidation strategy
- [ ] Avoid synchronous work on hot request paths

## Frontend
- [ ] LCP/INP/CLS within agreed budgets
- [ ] Code-split large routes; audit new dependency weight
- [ ] Images: dimensions, modern formats, lazy loading where appropriate
- [ ] Avoid blanket `memo`/`useMemo` without evidence

## CI Guardrails
- [ ] Bundle size budget (e.g. bundlesize / size-limit)
- [ ] Lighthouse CI or equivalent where applicable
- [ ] Regression test still passes after optimization

## Anti-Patterns
- Optimizing without a measured bottleneck
- Micro-optimizing cold paths while ignoring I/O
- Caching incorrect data
- Trading clear correctness for opaque "faster" code
