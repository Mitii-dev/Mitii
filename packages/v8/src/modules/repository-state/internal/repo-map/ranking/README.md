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

- **Computes** importance here (repository-state).
- **Consumes** via published `RepoMap.entries[].score` / `pageRank` in
  `repository-context` hybrid retrieval (`RepoMapRetrievalSource`, optional
  post-RRF boost). Context must **not** recompute PageRank.

Personalization uses referencer→definer edges. Courtesy inspiration
acknowledgement (not copied upstream source): see `Mitii/NOTICE-REVIEW.md`.
