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

## Layout

```text
repository-context/
├── contracts/          # public input/output schemas + types
├── pipeline/           # RepositoryContextPipeline facade
├── policy.ts           # public budget scaling helper
├── internal/           # hybrid-retrieval, context-selection, context-assembly
└── index.ts
```
