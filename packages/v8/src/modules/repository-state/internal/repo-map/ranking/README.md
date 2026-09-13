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

Inspired by Aider `repomap.py` (referencer→definer edges + personalization),
adapted to Mitii’s published RepoGraph / RepoMap artifacts.
