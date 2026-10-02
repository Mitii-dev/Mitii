# Repo-map ranking

Owns **personalized PageRank** and importance contracts used to build
published `RepoMap` entries.

## Files

| File | Role |
|---|---|
| `pageRank.ts` | Pure `computePageRank` (damping, iterations, personalization, dangling) |
| `RepoMapRanker.ts` | Graph → personalization → PageRank → composite file scores |
| `importance.ts` | `ImportanceScore` contracts + path lookup helpers |
| `pageRank.spec.ts` | Pure unit tests |

## Ownership

- **Computes** importance here (repository-state), including query-time
  `RepoMapRanker.rank({ graph, context })` invoked by repository-context for
  session-conditioned map retrieval candidates.
- **Consumes** published `RepoMap.entries[].score` / `pageRank` as the
  index-time baseline and for optional post-RRF importance boost.
- Context must **not** reimplement PageRank locally — only call this ranker.

Personalization uses referencer→definer edges with identifier-quality
multipliers and session chat-file referrer boosts. Courtesy inspiration
acknowledgement (not copied upstream source): see `Mitii/NOTICE-REVIEW.md`.
