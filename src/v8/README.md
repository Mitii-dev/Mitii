# V8 Pipeline Library

V8 is the headless capability plane for the Engine runtime. Phase 0 consolidated
business facades under `modules/`. Phases 1–7 completed public contracts through
the single-agent read-only Agent Engine. Phase 8 adds mutation, approval, and
checkpoints. Engine orchestration now lives under `engine/`.

## Module layout

```text
src/v8/
├── engine/
│   ├── agent-engine/        AgentEnginePipeline (run orchestration)
│   └── tool-runtime/        ToolRuntimePipeline (granted tool execution)
└── modules/
    ├── request-intake/          RequestIntakePipeline (mode + envelope)
    ├── request-understanding/   RequestUnderstandingPipeline (intent + task analysis)
    ├── repository-state/        RepositoryStatePipeline + WorkspaceIndexingPipeline + language registry
    ├── repository-context/      RepositoryContextPipeline (state ref → retrieval → selection → assembly)
    ├── decision-policy/         DecisionPolicyPipeline (route + grant + verification policy)
    ├── prompt-construction/     PromptConstructionPipeline (budgeted ModelRequest)
    ├── model-gateway/           LlmPort + Echo / OpenAI-compatible adapters
    └── verification/            VerificationPipeline (evidence-gated completion)
```

## Public pipelines

| Module | Pipeline | Input → Output |
|--------|----------|----------------|
| `request-intake` | `RequestIntakePipeline` | `CreateUserRequestInput` → `UserRequestEnvelope` |
| `request-understanding` | `RequestUnderstandingPipeline` | `UserRequestEnvelope` → `RequestUnderstandingResult` |
| `repository-state` | `RepositoryStatePipeline` | candidate → published `RepositoryStateReference` |
| `repository-context` | `RepositoryContextPipeline` | `RepositoryStateReference` + query → context result |
| `decision-policy` | `DecisionPolicyPipeline` | envelope + understanding → `ExecutionDecision` |
| `prompt-construction` | `PromptConstructionPipeline` | decision + context → `ModelRequest` + budget |
| `tool-runtime` | `ToolRuntimePipeline` | authorized call → `ToolResult` |
| `verification` | `VerificationPipeline` | change + state + policy → verification result |
| `agent-engine` | `AgentEnginePipeline` | start request → `AgentRunHandle` |

## Import policy

Applications import only from `src/v8/index.ts`, an engine public `index.ts`, or
a module's public `index.ts`:

```ts
import {
  RequestIntakePipeline,
  RequestUnderstandingPipeline,
  RepositoryStatePipeline,
  RepositoryContextPipeline,
  DecisionPolicyPipeline,
  PromptConstructionPipeline,
  ToolRuntimePipeline,
  VerificationPipeline,
  AgentEnginePipeline,
  composeReadOnlyAgentEngine,
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
  MODEL_PROVIDER_SUPPORT,
  defaultLanguageProfileRegistry,
} from "./v8";
```

Never import another module's `internal/` or `actions/` paths from outside that module.


## Tests

Contract and integration specs live under `src/v8/**/tests/` and
`*.spec.ts` files. Run them with:

```bash
pnpm run test:v8
```

Native modules (`better-sqlite3`, `@lancedb/lancedb`) require `pnpm run rebuild:node`
when switching Node versions.
