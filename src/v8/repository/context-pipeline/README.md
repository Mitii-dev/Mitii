# Repository Context Pipeline

```text
Input:
  query + mode + WorkspaceSnapshot + optional RepoMap/RepoGraph + IDE references

Output:
  retrieval + selection + safe assembled ContextBlocks
```

The pipeline performs only orchestration:

```text
Hybrid Retrieval
      ↓
Context Selection
      ↓
Context Assembly
```

Each stage remains independently replaceable and testable through injected
ports. The pipeline does not build prompts, call an LLM, execute tools, manage
cache, emit telemetry, or select providers.
