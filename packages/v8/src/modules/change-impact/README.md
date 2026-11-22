# Change Impact

Change Impact estimates the blast radius of a code change by walking a repository graph from a file, symbol, or caret seed. It helps policy, planning, and tools understand what else may be affected.

## What This Module Does

- Validates change-impact input.
- Resolves a file/symbol/caret seed against a `RepoGraph`.
- Traverses dependency or dependent edges (including package / workspace edges when packages are included).
- Applies hop, node, and path/chain limits; retains best same-hop edge/score.
- Summarizes affected nodes, files (prod/test buckets), packages, and impact chains.
- Reports graph confidence from published unresolved/omitted edge statistics; marks `graph_confidence_unsafe` and forces `partial` when the graph cannot be trusted for narrow selection.
- Classifies blast radius (level, fragility, risk score/tier) and auditable `impactReason` codes per affected file.
- Keeps full-walk `totals` accurate even when model-facing lists are later capped.
- Reports truncation, unresolved seeds, stale graph signals, hop-1 neighbor counts, and warnings.
- Defaults file seeds to `file_exports` (exported or externally referenced symbols) instead of exploding every symbol.
- Soft-resolves symbol seeds (case/qualified name + optional text-occurrence hints) before falling back to file-level expand.
- Optionally multiplies walk scores by published RepoMap importance (PageRank/composite) — never recomputes ranking.
- Exposes `mergeNavigationEnrichment` so Tool Runtime can merge live code-nav/LSP or SCIP hits when the graph walk is empty or partial (`lsp_enriched` / `scip_enriched`).
- Exposes `compactChangeImpactForModelFacing` so Tool Runtime can ship a
  files-first, budget-safe tool payload (top-N nodes/files, short evidence, prod-first,
  prefix-collapsed chains) without discarding the full walk limits used for analysis.
- Exposes `recommendWidenVerification` so hosts can widen proportional verification when confidence is unsafe or risk is critical.
- Expands symbol seeds to related parent/child symbols via published nesting (`seed_rollup_expanded`).
- Accepts host `pathIdentityOverlays` for rename/delete so prior-path dependents stay reachable when those file nodes still exist.
- Package/workspace relationships now flow from the project catalog into package edge walks when `includePackages` is enabled.
- Applies capped host-published historical co-change boosts; evidence-gates same-package / prefix siblings as `hidden_coupling` when co-change exists without a structural edge.
- Detects short file-level cycles that touch the seed neighborhood and raises risk / widen-verification signals.
- Multi-seed merge (`analyzeManyChangeImpact`) unions blast radius conservatively (min confidence, max risk).
- Spillover checks compare affected packages against an expected set.
- Counterfactual `planCheckChangeImpact` analyzes proposed paths without writing the working tree.
- Tool Runtime exposes `analyze_change_impact` and `plan_check_change_impact` so agents can run the same pipelines.

## Structure

```text
change-impact/
  pipeline/                 ChangeImpactPipeline
  actions/                  Model-facing compact helpers
  contracts/
    input/                  ChangeImpactInput, ChangeImpactSeed
    output/                 ChangeImpactResult
    errors/                 ChangeImpactError
  internal/                 Graph traversal and scoring helpers
  tests/
```

## Types And Contracts

- `ChangeImpactInput`: seed, direction, edge types, hop/node limits, package flag, optional path-identity overlays, repo graph, and optional code-index token.
- `ChangeImpactSeed`: file, symbol, or caret seed.
- `ChangeImpactResult`: status, direction, seed, resolved seeds, affected nodes, affected files, packages affected, cycles, hidden coupling, totals, confidence, blast radius, truncation flag, warnings, reason codes, graph revision, and optional code-index token.
- `ChangeImpactAffectedFile`: file-level impact summary with `impactReason` for planning or verification choices.

## Technical Details

- The public facade method is `ChangeImpactPipeline.analyze` (single seed).
- Multi-seed and plan-check are actions: `analyzeManyChangeImpact`, `planCheckChangeImpact`, `evaluateSpillover`.
- Direction is usually dependencies or dependents.
- Edge types are constrained to known repository graph relationships.
- Limits protect very large graphs and set `truncated` when reached.
- Model-facing defaults (`CHANGE_IMPACT_POLICY.modelFacing*`) keep tool
  results sequencing-friendly under tool-result budgets; the walk may still
  visit up to `maximumAffectedNodes`.
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
  "status": "ok",
  "direction": "dependents",
  "seed": { "kind": "file", "relativePath": "src/LoginForm.tsx" },
  "resolvedSeeds": [{ "nodeId": "file:src/LoginForm.tsx", "kind": "file", "relativePath": "src/LoginForm.tsx" }],
  "affected": [
    { "nodeId": "file:src/LoginForm.test.tsx", "kind": "file", "relativePath": "src/LoginForm.test.tsx", "hop": 1, "viaEdgeType": "imports", "score": 0.86, "evidence": ["test imports LoginForm"] }
  ],
  "affectedFiles": [{ "relativePath": "src/LoginForm.test.tsx", "hop": 1, "score": 0.86, "affectedNodeIds": ["file:src/LoginForm.test.tsx"], "reason": "imports dependent at hop 1", "impactReason": "direct", "bucket": "test" }],
  "packagesAffected": [],
  "totals": { "affectedNodes": 1, "affectedFiles": 1, "packages": 0, "chains": 1 },
  "confidence": 1,
  "graphConfidenceUnsafe": false,
  "blastRadius": { "level": "low", "fragility": 0.0, "riskScore": 18, "riskTier": "safe", "detail": "1 affected file(s); 1 hop-1 file(s); fragility 0.00" },
  "truncated": false,
  "warnings": [],
  "reasonCodes": ["impact_resolved"]
}
```

## Ports

`RepositoryGraphPort` is owned here (`contracts/ports`) and exported from the index.
Planning and the tool runtime consume this type; neither defines its own.
Optional `loadHistoricalCoupling` supplies host-published co-change facts; change-impact never mines git history.
