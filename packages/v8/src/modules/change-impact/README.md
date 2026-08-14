# Change Impact

```text
Input:  ChangeImpactInput { seed, repoGraph, direction=dependents, budgets… }
Output: ChangeImpactResult { status, affected[], affectedFiles[], packagesAffected[], reasonCodes }
```

Answers “what depends on this change seed?” over a published `RepoGraph`.
Traversal walks configured edge types in reverse (callers, importers, package
dependents). Used by the `analyze_change_impact` tool and any other caller that
needs a bounded blast-radius report.

Does not own indexing, hybrid retrieval, tool grants, or planning dimensions
(`PlanArtifact.dimensions.changeImpact` remains categorical evidence, not this
report).

## Pipeline stages

1. Validate input
2. Resolve seed (`file` | `symbol` | `caret`) to graph node(s)
3. Walk reverse dependents with hop/node budgets
4. Aggregate files and optional packages; return status + reason codes

## Dependencies and ports

- Public `RepoGraph` from `repository-state`
- Optional `codeIndexChangeToken` for `graph_stale` when the caller knows a newer index watermark
- Hop and node budgets bound both the report size and traversal work (no further enqueue once the node budget is full)
- No filesystem, host, Agent Engine, or tool-runtime imports

## Public exports

| Export | Role |
|--------|------|
| `ChangeImpactPipeline` | Facade |
| `changeImpactInputSchema` / `changeImpactResultSchema` | Boundary |
| `CHANGE_IMPACT_POLICY` / constants / defaults | Budgets and stable codes |

## Failure modes

| Condition | `status` | Typical `reasonCodes` |
|-----------|----------|------------------------|
| Dependents found | `ok` | `impact_resolved` |
| Truncated or stale/partial graph | `partial` | `hop_limit_reached`, `node_limit_reached`, `graph_stale` |
| Seed resolved, nothing depends | `empty` | `no_dependents` |
| Seed missing | `empty` | `seed_unresolved` |
| Invalid input | throws `ChangeImpactError` | `invalid_input` |

Tool-runtime maps a missing/empty graph port to tool output `unavailable` /
`graph_unavailable` without throwing.

## Genericness strategy

Edge types and scoring live in `policy.ts`. Language-specific extraction stays
in repository-state graph construction. Seeds are path/symbol/caret only.

## Explicit non-responsibilities

- Building or refreshing RepoGraph
- Bidirectional retrieval neighbor expansion (`repository-context`)
- LSP find-references (use `code-navigation`)
- Automatic pre-edit invocation in Agent Engine
- Host UI / SDK convenience wrappers beyond V8 exports
