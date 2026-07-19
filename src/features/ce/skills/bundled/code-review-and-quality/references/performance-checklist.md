# Performance Review Checklist

Use during the performance axis of `code-review-and-quality`. For deep optimization work, prefer the `performance-optimization` skill.

## Data Access
- [ ] No N+1 query patterns
- [ ] List endpoints paginated / bounded
- [ ] Expensive queries indexed or justified
- [ ] Caching only where correctness is clear

## Runtime
- [ ] No unbounded loops over large collections in hot paths
- [ ] Streaming/pagination for large payloads
- [ ] Background work not blocking request path without reason

## Frontend (if applicable)
- [ ] No unnecessary large re-renders
- [ ] Images sized/lazy-loaded when relevant
- [ ] Bundle impact of new deps considered

## Evidence
- [ ] Claimed performance fixes include before/after measurements or a clear measurement plan
