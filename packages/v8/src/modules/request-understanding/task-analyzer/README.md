# Task Analyzer

Task Analyzer is the deterministic dimension extractor inside Request Understanding. It turns the current request and intent result into structured task analysis.

## What This Component Does

- Extracts target files, folders, symbols, packages, repositories, or workspace-level targets.
- Classifies scope, complexity, risk, and clarity.
- Extracts constraints and requested outcomes.
- Emits recommendations for repository discovery, planning, verification, and clarification.
- Records weighted signals and confidence for auditability.

## Structure

```text
task-analyzer/
  TaskAnalyzer.ts
  analyzer/                 Scope, complexity, risk, clarity, target, outcome extractors
  classifier/               Rulewise analyzer implementation
  contracts/
    input/                  TaskAnalyzerInput
    output/                 TaskAnalysis and stage details
  tests/
```

## Types And Contracts

- `TaskAnalyzerInput`: `userMessage`, Super Intent result, and optional referenced artifacts.
- `TaskAnalysis`: final dimension output.
- `TaskScope`: `single_location`, `multi_file`, `package`, `repository`, `workspace`, or `unknown`.
- `TaskComplexity`: `trivial`, `simple`, `moderate`, `complex`, or `very_complex`.
- `TaskRisk`: `low`, `medium`, `high`, or `critical`.
- `TaskClarity`: `clear`, `partially_clear`, or `unclear`.
- `TaskTarget`: target kind/value/explicit flag.

## Technical Details

- `TaskAnalyzer.analyze` validates and normalizes the request.
- LLM hints can be merged by the parent Request Understanding pipeline, but the analyzer remains useful without an LLM.
- Explicit artifact paths are treated as stronger evidence than inferred paths.
- Recommendations are not permissions; they are consumed by Decision Policy and Planning.

## Ownership Boundaries

Owns task dimension extraction.

Does not own Super Intent scoring, route selection, plan drafting, repository retrieval, or tool grants.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/request-understanding/task-analyzer
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

TaskAnalyzerInput -> TaskAnalysis:

```json
{
  "userMessage": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "intent": "SuperIntent result with primaryTaskIntent=implementation",
  "referencedArtifacts": [{ "kind": "file", "name": "LoginForm.tsx", "path": "src/LoginForm.tsx" }]
}
```

### Step-By-Step Flow

1. A user sends the real prompt shown above from an editor or chat host.
2. The host attaches workspace id `workspace-1` and the explicit target file `src/LoginForm.tsx`.
3. The module receives the real structure shown in the input block.
4. The module validates schema/version/limits before doing any work.
5. The module extracts the important target: `src/LoginForm.tsx`.
6. The module keeps the user constraint: existing validation and error handling must stay intact.
7. The module performs only its own responsibility and does not cross into neighboring modules.
8. Any budget, path, state, or provider constraint is applied before output is produced.
9. The module records warnings/reason codes instead of hiding degraded behavior.
10. The module returns the realistic output shape shown below.
11. The next pipeline stage consumes that output without reinterpreting raw user text.

### Realistic Output

Task Analyzer output returns a result like this:

```json
{
  "scope": "single_location",
  "complexity": "simple",
  "risk": "low",
  "clarity": "clear",
  "targets": [{ "kind": "file", "value": "src/LoginForm.tsx", "explicit": true }],
  "constraints": ["keep existing validation", "keep existing error handling"],
  "requestedOutcomes": ["button disabled while pending", "loading label visible"],
  "estimatedFilesAffected": { "minimum": 1, "maximum": 2 },
  "recommendsRepositoryDiscovery": true,
  "recommendsPlanning": false,
  "recommendsVerification": true,
  "recommendsTaskClarification": false,
  "confidence": 0.88
}
```
