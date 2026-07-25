# V8 Pipeline Library

V8 is the headless capability plane for the Engine runtime. Phase 0 consolidates
existing code under `modules/` with four public orchestration pipelines.

## Module layout

```text
src/v8/modules/
├── request-intake/          UserRequestEnvelopeBuilder (mode + envelope)
├── request-understanding/   IntentRouter (intent + task analysis internals)
├── repository-state/        WorkspaceIndexingPipeline (indexing orchestration)
├── repository-context/      RepositoryContextPipeline (retrieval → selection → assembly)
└── model-gateway/           ModelCapabilityResolver + provider contracts
```

## Public pipelines (Phase 0)

| Module | Pipeline | Input → Output |
|--------|----------|----------------|
| `request-intake` | `UserRequestEnvelopeBuilder` | `CreateUserRequestInput` → `UserRequestEnvelope` |
| `request-understanding` | `IntentRouter` | `IntentClassificationInput` → `SuperIntentResult` |
| `repository-state` | `WorkspaceIndexingPipeline` | `WorkspaceIndexingPipelineInput` → `WorkspaceIndexingPipelineResult` |
| `repository-context` | `RepositoryContextPipeline` | `RepositoryContextPipelineInput` → `RepositoryContextPipelineResult` |

## Import policy

Applications import only from `src/v8/index.ts` or a module's public `index.ts`:

```ts
import {
  UserRequestEnvelopeBuilder,
  IntentRouter,
  WorkspaceIndexingPipeline,
  RepositoryContextPipeline,
} from "./v8";
```

Never import another module's `internal/` or `actions/` paths from outside that module.

## Tests

Fourteen contract and integration specs live under `src/v8/modules/**/tests/` and
`*.spec.ts` files. Run them with:

```bash
pnpm run test:v8
```

Native modules (`better-sqlite3`, `@lancedb/lancedb`) require `pnpm run rebuild:node`
when switching Node versions.
