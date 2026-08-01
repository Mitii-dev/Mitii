# `@mitii/v8`

Host-neutral Mitii agent runtime: intake → understanding → decision policy → repository context → prompt construction → model/tool loop → verification.

The model is never the permission authority. Decision Policy owns routes, grants, approval mode, and verification requirements. Hosts inject ports (filesystem, SQLite, LLM, search, skills, memory).

## Install

```bash
npm install @mitii/v8
```

Requires **Node.js 20+**. License: **AGPL-3.0-or-later**.

Most apps should use [`@mitii/sdk`](https://www.npmjs.com/package/@mitii/sdk) (`createMitiiClient`) instead of wiring pipelines by hand. Use this package when you need the V8 modules/ports directly.

## Quick start

```ts
import {
  AgentEnginePipeline,
  EchoLlmPort,
  RequestIntakePipeline,
  RequestUnderstandingPipeline,
  DecisionPolicyPipeline,
  PromptConstructionPipeline,
  ToolRuntimePipeline,
  VerificationPipeline,
  composeReadOnlyAgentEngine,
} from '@mitii/v8';

// Prefer @mitii/sdk for a full client. Direct composition example:
const understandingLlm = new EchoLlmPort();
const runLlm = new EchoLlmPort();
// …inject host ports, then compose AgentEnginePipeline / composeReadOnlyAgentEngine
```

## Module layout

```text
src/
├── engine/
│   ├── agent-engine/        AgentEnginePipeline (run orchestration)
│   └── tool-runtime/        ToolRuntimePipeline (granted tool execution)
└── modules/
    ├── request-intake/
    ├── request-understanding/
    ├── repository-state/
    ├── repository-context/
    ├── decision-policy/
    ├── planning/
    ├── prompt-construction/
    ├── model-gateway/         Echo + OpenAI-compatible LlmPort
    ├── skills/
    ├── memory/
    └── verification/
```

## Public pipelines

| Module | Pipeline | Input → Output |
|--------|----------|----------------|
| `request-intake` | `RequestIntakePipeline` | `CreateUserRequestInput` → `UserRequestEnvelope` |
| `request-understanding` | `RequestUnderstandingPipeline` | envelope → understanding result |
| `repository-state` | `RepositoryStatePipeline` | candidate → published `RepositoryStateReference` |
| `repository-context` | `RepositoryContextPipeline` | state ref + query → context |
| `decision-policy` | `DecisionPolicyPipeline` | envelope + understanding → `ExecutionDecision` |
| `planning` | `PlanningPipeline` | evidence + depth → `PlanArtifact` |
| `prompt-construction` | `PromptConstructionPipeline` | decision + context → budgeted `ModelRequest` |
| `tool-runtime` | `ToolRuntimePipeline` | authorized call → `ToolResult` |
| `verification` | `VerificationPipeline` | change + state + policy → verification result |
| `agent-engine` | `AgentEnginePipeline` | start request → `AgentRunHandle` |

## Import policy

Import only from the package root (`@mitii/v8`). Never import another module's `internal/` or `actions/` paths.

```ts
import {
  RequestIntakePipeline,
  DecisionPolicyPipeline,
  AgentEnginePipeline,
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
  MODEL_PROVIDER_SUPPORT,
} from '@mitii/v8';
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for component boundaries, request flows, storage, security, and an end-to-end example.

## Development (monorepo)

```bash
pnpm --filter @mitii/v8 typecheck
pnpm --filter @mitii/v8 test
pnpm --filter @mitii/v8 build
```

`pnpm --filter @mitii/v8 test` auto-heals `better-sqlite3` ABI mismatches (Electron vs system Node). Prefer `pnpm run rebuild:native` for F5 — it stages the Electron binding and restores Node ABI afterward.

## Links

- Repo: [Mitii-dev/Mitii](https://github.com/Mitii-dev/Mitii)
- Docs: [docs.mitii.dev](https://docs.mitii.dev)
- Related: `@mitii/sdk`, `@mitii/host`, `@mitii/cli`
