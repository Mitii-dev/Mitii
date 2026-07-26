# Repository Context Pipeline

```text
Input:
  RepositoryStateReference + query + mode + optional filters/budget/references

Output:
  stateToken + retrieval + selection + safe assembled ContextBlocks
```

The public boundary accepts **only** a published state reference. Snapshot, map,
graph, and index revisions are resolved through an injected state resolver so
callers cannot mix independently supplied artifacts.

```text
Resolve Repository State
      ↓
Hybrid Retrieval
      ↓
Context Selection
      ↓
Context Assembly
```

Each stage remains independently replaceable and testable through injected
ports. The pipeline does not build prompts, call an LLM, execute tools, manage
cache, emit telemetry, or select providers.

Unknown or unavailable states fail closed without retrieval. Degraded states
continue with an explicit warning.
