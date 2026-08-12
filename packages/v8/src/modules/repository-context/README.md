# Repository Context

```text
Input:  RepositoryContextPipelineInput (state reference + query + mode)
Output: RepositoryContextPipelineResult
```

Builds grounded repository context for a pinned `RepositoryStateReference`.
Retrieval, selection, and assembly stay under `internal/`; public contracts live
in `contracts/`. Callers may pass `selectionBudget`, or use
`deriveContextSelectionBudget(contextWindowTokens)` from `policy.ts` to scale
defaults with the active model window.

Hosts may inject `gitDiffFiles`, `currentFile`, and `openFiles` as selection
priors. The pipeline also forwards those paths as `anchorFilePaths` so
RepoGraph blast-radius expansion starts from the edit set, not only query
tokens. After a text-index schema upgrade, rebuild the workspace index so
identifier-aware FTS and call-graph hops stay current. Hosts inject
`IdentifierAwareRetrievalReranker` after RRF for identifier/path overlap.

## Layout

```text
repository-context/
├── contracts/          # public input/output schemas + types
├── pipeline/           # RepositoryContextPipeline facade
├── policy.ts           # public budget scaling helper
├── internal/           # hybrid-retrieval, context-selection, context-assembly
└── index.ts
```
