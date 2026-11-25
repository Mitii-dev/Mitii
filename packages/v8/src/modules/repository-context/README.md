# Repository Context

Turns a pinned repository state and a user query into prompt-safe
code/context blocks: resolve state → retrieve → select → assemble.

## Contract

**In:** `RepositoryContextPipelineInput` (state reference, query, mode,
filters, breadth, references, selection budget).  
**Out:** `RepositoryContextPipelineResult` (retrieval, selection, assembly,
warnings, statistics).

| Facade | Stages |
|---|---|
| `execute` | 1-resolve → 2-prepare → 3-retrieve → 4-select → 5-assemble → 6-finalize |

Ports (injected): `RepositoryContextStateResolverPort`,
`RepositoryContextRetrieverPort`, `RepositoryContextSelectorPort`,
`RepositoryContextAssemblerPort`, optional `ModuleLoggerPort`.

Factories: `HybridRetrievalFactory`, `ContextSelector`,
`ContextAssemblyFactory` (adapters).

## Example

```ts
import {
  RepositoryContextPipeline,
  HybridRetrievalFactory,
  ContextSelector,
  ContextAssemblyFactory,
} from "@mitii/v8/modules/repository-context";

const pipeline = new RepositoryContextPipeline({
  stateResolver,
  retriever: HybridRetrievalFactory.create(options),
  selector: new ContextSelector(),
  assembler: ContextAssemblyFactory.create(options),
});
const result = await pipeline.execute(input);
```

## Non-responsibilities

Repository indexing/publishing (repository-state), prompt assembly
(prompt-construction), and tool execution. Hybrid retrieval / selection /
assembly internals live under `helpers/`.
