# Task Analyzer

```text
Input:  TaskAnalyzerInput (user message + SuperIntentResult + optional artifacts)
Output: TaskAnalysis
```

Deterministic task-shape analysis that runs **after** intent classification. The
analyzer estimates scope, complexity, risk, clarity, targets, constraints, and
downstream recommendations without reading repository contents or making
execution-policy decisions.

## Public API

| Export | Role |
|--------|------|
| `TaskAnalyzer` | Public orchestrator (`analyze`) |
| `TaskAnalysisSchema` | Output contract validation |
| `taskAnalyzerInputSchema` | Input contract validation |
| `TASK_ANALYZER_CONSTANTS` | Patterns, thresholds, intent defaults |
| `TASK_ANALYZER_SOURCE_FILE_EXTENSIONS` | Language-agnostic file extension catalog |

## Actions (internal)

| Action | Responsibility |
|--------|----------------|
| `TaskTargetExtractor` | Files, folders, symbols, scope targets |
| `TaskConstraintExtractor` | Prohibitions, requirements, technology constraints |
| `TaskOutcomeExtractor` | Explicit requested outcomes |
| `TaskScopeAnalyzer` | single_location → workspace scope |
| `TaskComplexityAnalyzer` | trivial → very_complex scoring |
| `TaskRiskAnalyzer` | low → critical execution risk |
| `TaskClarityAnalyzer` | clear / partially_clear / unclear |
| `RulewiseTaskAnalyzer` | Composes all actions into `TaskAnalysis` |

## Contracts

```text
contracts/
├── input/TaskAnalyzerInput.ts
└── output/
    ├── TaskAnalysis.ts
    └── TaskAnalysisStages.ts
```

## Language coverage

File-target detection uses `TASK_ANALYZER_SOURCE_FILE_EXTENSIONS`, aligned with
`repository-state` source analysis. Extensions cover the top programming
languages (TypeScript/JavaScript, Python, Java, Go, Rust, C#, Ruby, PHP,
Swift, Kotlin, Scala, C/C++) plus common config and markup formats.

## Do not put here

- Intent classification (`intent/`)
- Repository indexing or retrieval
- Execution routing, tool access, or approval policy
- Plan generation or verification command selection

## Tests

```bash
pnpm run test:v8 -- src/v8/modules/request-understanding/task-analyzer/tests
```
