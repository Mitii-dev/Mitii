# Request Understanding

```text
Input:  UserRequestEnvelope (RequestUnderstandingPipelineInput)
Output: RequestUnderstandingResult { intent, taskAnalysis }
```

Headless request understanding for the V8 pipeline. Intent classification and
task-shape analysis are private stages behind one public facade. Outputs are
evidence and recommendations only — Decision Policy authorizes routes and grants.

## Public pipeline

| Export | Role |
|--------|------|
| `RequestUnderstandingPipeline` | Public orchestrator (`understand`) |
| `requestUnderstandingResultSchema` / `RequestUnderstandingResult` | Boundary result |
| `TaskAnalysisSchema` / `TaskAnalysis` | Task evidence including `recommends*` fields |

```ts
const pipeline = new RequestUnderstandingPipeline(llmPort);
const result = await pipeline.understand(envelope);
```

## Flow

```text
UserRequestEnvelope
  → IntentRouter.classify()          (private)
  → TaskAnalyzer.analyze(...)        (private)
  → RequestUnderstandingResult
```

## Contracts

```text
contracts/
├── input/RequestUnderstandingPipelineInput.ts
└── output/RequestUnderstandingResult.ts
```

## Do not put here

- Raw envelope validation (`request-intake`)
- Repository indexing or context retrieval
- Decision policy, tool runtime, or agent loop orchestration

## Tests

```bash
pnpm exec vitest run src/v8/modules/request-understanding
```
