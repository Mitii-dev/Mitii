# V8 Capability Library

V8 is the capability and data plane used by the future Engine runtime.
Each module has an explicit input, output, schema, constants, and test surface.

## Foundation contracts

```text
interaction-mode/
  Input:  unknown mode value
  Output: AgentMode

request-envelope/
  Input:  CreateUserRequestInput
  Output: UserRequestEnvelope

model-gateway/
  Input:  ModelRequest
  Output: AsyncIterable<ModelResponseDelta>
```

The former broad `core/` module has been removed. Run lifecycle, provider
selection, retries, cache coordination, telemetry, prompt orchestration, tool
execution, secrets, and monetary budgets belong to the future Engine unless a
reusable V8 capability develops a concrete need for a smaller port.

## Repository request flow

```text
WorkspaceSnapshot
      ↓
ProjectCatalog → Code Index → Repo Graph → Repo Map
                                      ↘
Query → Hybrid Retrieval → Context Selection → Context Assembly
                                      ↑                  ↓
                         IDE references          safe ContextBlocks
```

`repository/context-pipeline` owns only the final three-stage orchestration:

```text
RepositoryContextPipelineInput
      ↓
Hybrid Retrieval
      ↓
Context Selection
      ↓
Context Assembly
      ↓
RepositoryContextPipelineResult
```

## Import policy

Applications should import the narrow module they use:

```ts
import { IntentRouter } from "./v8/intent";
import { RepositoryContextPipeline } from "./v8/repository/context-pipeline";
import type { LlmPort } from "./v8/model-gateway";
```

The root barrels are discovery conveniences. Internal V8 type dependencies use
direct `types.ts` paths so importing a contract does not compile or initialize
unrelated adapters.
