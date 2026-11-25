# Change Impact

**Does:** estimate blast radius of a code change by walking a published `RepoGraph` from a file / symbol / caret seed. Does not build the graph, run verification, or mutate the working tree.

## Contract

```text
ChangeImpactInput + RepoGraph
  → ChangeImpactPipeline.analyze()
  → ChangeImpactResult (affected*, blastRadius, reasonCodes, confidence)

Multi-seed / plan-check / spillover are actions on top of analyze:
  analyzeManyChangeImpact → merge
  planCheckChangeImpact → counterfactual paths
  evaluateSpillover → package set diff
```

| Signal | Effect |
|---|---|
| `seed` + `direction` | resolve + walk dependents or dependencies |
| `maximumHops` / nodes / paths | truncation bounds |
| `historicalCoupling` | co-change boost + hidden coupling |
| `includePackages` | package / workspace edges |

## Example

```ts
const result = new ChangeImpactPipeline().analyze({
  schemaVersion: 1,
  seed: { kind: "file", relativePath: "src/LoginForm.tsx" },
  direction: "dependents",
  repoGraph,
  maximumHops: 3,
  maximumAffectedNodes: 80,
});

// result.status === "ok" | "partial" | "empty"
// result.blastRadius.level / riskTier
// result.reasonCodes may include "impact_resolved", "graph_confidence_unsafe", …
```
