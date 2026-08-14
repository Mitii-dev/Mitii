# Change Impact

Change Impact estimates the blast radius of a code change by walking a repository graph from a file, symbol, or caret seed. It helps policy, planning, and tools understand what else may be affected.

## What This Module Does

- Validates change-impact input.
- Resolves a file/symbol/caret seed against a `RepoGraph`.
- Traverses dependency or dependent edges.
- Applies hop and node limits.
- Summarizes affected nodes, files, and packages.
- Reports truncation, unresolved seeds, stale graph signals, and warnings.

## Structure

```text
change-impact/
  pipeline/                 ChangeImpactPipeline
  contracts/
    input/                  ChangeImpactInput, ChangeImpactSeed
    output/                 ChangeImpactResult
    errors/                 ChangeImpactError
  internal/                 Graph traversal and scoring helpers
  tests/
```

## Types And Contracts

- `ChangeImpactInput`: seed, direction, edge types, hop/node limits, package flag, repo graph, and optional code-index token.
- `ChangeImpactSeed`: file, symbol, or caret seed.
- `ChangeImpactResult`: status, direction, seed, resolved seeds, affected nodes, affected files, packages affected, truncation flag, warnings, reason codes, graph revision, and optional code-index token.
- `ChangeImpactAffectedFile`: file-level impact summary used by planning or verification choices.

## Technical Details

- The public facade method is `ChangeImpactPipeline.analyze`.
- Direction is usually dependencies or dependents.
- Edge types are constrained to known repository graph relationships.
- Limits protect very large graphs and set `truncated` when reached.
- Normal unresolved/stale cases return structured results rather than throwing.

## Ownership Boundaries

Owns graph-based impact analysis.

Does not own graph construction, repository indexing, route authority, verification execution, or tool mutation.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/change-impact
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

ChangeImpactInput -> ChangeImpactResult:

```json
{
  "prompt": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "workspaceId": "workspace-1",
  "stateToken": "state-abc",
  "targetFile": "src/LoginForm.tsx"
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

Change Impact result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "complete",
  "direction": "dependents",
  "seed": { "kind": "file", "relativePath": "src/LoginForm.tsx" },
  "resolvedSeeds": [{ "nodeId": "file:src/LoginForm.tsx", "kind": "file", "relativePath": "src/LoginForm.tsx" }],
  "affected": [
    { "nodeId": "file:src/LoginForm.test.tsx", "kind": "file", "relativePath": "src/LoginForm.test.tsx", "hop": 1, "viaEdgeType": "imports", "score": 0.86, "evidence": ["test imports LoginForm"] }
  ],
  "affectedFiles": [{ "relativePath": "src/LoginForm.test.tsx", "hop": 1, "score": 0.86, "affectedNodeIds": ["file:src/LoginForm.test.tsx"], "reason": "dependent test imports changed component" }],
  "packagesAffected": [],
  "truncated": false,
  "warnings": [],
  "reasonCodes": ["impact_resolved"]
}
```
