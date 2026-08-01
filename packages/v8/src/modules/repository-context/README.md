# Repository Context

```text
Input:  RepositoryContextPipelineInput (state reference + query + mode)
Output: RepositoryContextPipelineResult
```

Builds grounded repository context for a pinned `RepositoryStateReference`.
Retrieval, selection, and assembly stay under `internal/`; public contracts live
in `contracts/`.

## Layout

```text
repository-context/
├── contracts/          # public input/output schemas + types
├── pipeline/           # RepositoryContextPipeline facade
├── internal/           # hybrid-retrieval, context-selection, context-assembly
└── index.ts
```
