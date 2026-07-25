# V8 Pipeline Library

V8 is the headless capability plane for the Engine runtime. Phase 0 consolidated
code under `modules/`. Phase 1 completed public contracts: intake and
understanding facades, recommendation-only task analysis, discriminated model
events, provider support matrix, and language registry contracts.

## Module layout

```text
src/v8/modules/
├── request-intake/          RequestIntakePipeline (mode + envelope)
├── request-understanding/   RequestUnderstandingPipeline (intent + task analysis)
├── repository-state/        WorkspaceIndexingPipeline + language registry
├── repository-context/      RepositoryContextPipeline (retrieval → selection → assembly)
└── model-gateway/           LlmPort + Echo / OpenAI-compatible adapters
```

## Public pipelines

| Module | Pipeline | Input → Output |
|--------|----------|----------------|
| `request-intake` | `RequestIntakePipeline` | `CreateUserRequestInput` → `UserRequestEnvelope` |
| `request-understanding` | `RequestUnderstandingPipeline` | `UserRequestEnvelope` → `RequestUnderstandingResult` |
| `repository-state` | `WorkspaceIndexingPipeline` | indexing input → indexing result |
| `repository-context` | `RepositoryContextPipeline` | context input → context result |

## Import policy

Applications import only from `src/v8/index.ts` or a module's public `index.ts`:

```ts
import {
  RequestIntakePipeline,
  RequestUnderstandingPipeline,
  WorkspaceIndexingPipeline,
  RepositoryContextPipeline,
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
  MODEL_PROVIDER_SUPPORT,
  defaultLanguageProfileRegistry,
} from "./v8";
```

Never import another module's `internal/` or `actions/` paths from outside that module.

## Tests

Contract and integration specs live under `src/v8/modules/**/tests/` and
`*.spec.ts` files. Run them with:

```bash
pnpm run test:v8
```

Native modules (`better-sqlite3`, `@lancedb/lancedb`) require `pnpm run rebuild:node`
when switching Node versions.
