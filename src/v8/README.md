# V8 Pipeline Library

V8 is the headless capability plane for the Engine runtime. Phase 0 consolidated
code under `modules/`. Phase 1 completed public contracts. Phase 2 completed
authoritative repository state publication. Phase 3 completed Decision Policy
for deterministic route, planning-depth, and tool-grant authority.

## Module layout

```text
src/v8/modules/
├── request-intake/          RequestIntakePipeline (mode + envelope)
├── request-understanding/   RequestUnderstandingPipeline (intent + task analysis)
├── repository-state/        RepositoryStatePipeline + WorkspaceIndexingPipeline + language registry
├── repository-context/      RepositoryContextPipeline (state ref → retrieval → selection → assembly)
├── decision-policy/         DecisionPolicyPipeline (route + grant + verification policy)
└── model-gateway/           LlmPort + Echo / OpenAI-compatible adapters
```

## Public pipelines

| Module | Pipeline | Input → Output |
|--------|----------|----------------|
| `request-intake` | `RequestIntakePipeline` | `CreateUserRequestInput` → `UserRequestEnvelope` |
| `request-understanding` | `RequestUnderstandingPipeline` | `UserRequestEnvelope` → `RequestUnderstandingResult` |
| `repository-state` | `RepositoryStatePipeline` | candidate → published `RepositoryStateReference` |
| `repository-context` | `RepositoryContextPipeline` | `RepositoryStateReference` + query → context result |
| `decision-policy` | `DecisionPolicyPipeline` | envelope + understanding → `ExecutionDecision` |

## Import policy

Applications import only from `src/v8/index.ts` or a module's public `index.ts`:

```ts
import {
  RequestIntakePipeline,
  RequestUnderstandingPipeline,
  RepositoryStatePipeline,
  RepositoryContextPipeline,
  DecisionPolicyPipeline,
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
