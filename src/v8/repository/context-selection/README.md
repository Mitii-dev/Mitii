# Context Selection

`context-selection` converts hybrid retrieval evidence and direct user or
editor references into a deterministic, bounded selection plan.

It answers one question:

> Which repository items should the next context-assembly stage load, and how
> much of each item may it use?

## Boundary

This module:

- preserves explicit, pinned, current-file, selection, diff, diagnostic,
  open-file, and recent-edit context;
- merges those references with hybrid retrieval candidates;
- scores candidates with explainable signals;
- applies mode-aware representation choices;
- introduces deterministic path diversity;
- enforces hard token, item, file, and per-file limits;
- reports every material omission or downgrade;
- validates its public input and output.

This module does not:

- search SQLite, LanceDB, the repository graph, or the filesystem;
- read file contents;
- estimate the model's complete prompt window;
- render repository content into prompt text;
- log, emit telemetry, retry, schedule work, or select providers;
- decide whether the agent should act.

Those responsibilities belong to retrieval sources, `context-assembly`, and
the V8 engine runtime.

## Pipeline

```text
HybridRetrievalResult + direct references + hard budget
                         |
                         v
             ContextCandidatePreparer
                         |
                         v
              ContextSelectionScorer
                         |
                         v
              ContextDiversityRanker
                         |
                         v
               ContextBudgetAllocator
                         |
                         v
              ContextSelectionResult
```

## Usage

```ts
import { ContextSelector } from "./context-selection";

const selector = new ContextSelector({
  requiredOverflowMode: "partial",
});

const result = selector.select({
  query: "Fix the authentication regression",
  retrieval,
  mode: "agent",
  breadth: "balanced",
  references: {
    currentFile: {
      rootId: "app",
      relativePath: "src/auth/session.ts",
    },
    gitDiffFiles: [
      {
        rootId: "app",
        relativePath: "src/auth/token.ts",
      },
    ],
  },
  budget: {
    maximumTokens: 12_000,
    maximumItems: 24,
    maximumFiles: 16,
    maximumItemsPerFile: 3,
  },
});
```

Each selected item contains a representation and `allocatedTokens`.
`context-assembly` must treat that allocation as a hard upper bound when it
loads and renders content.

## Required references

Explicit files and explicitly referenced editor selections are required.
When a required item cannot fit:

- `"partial"` returns a partial result with a visible omission; or
- `"fail"` returns a failed result with no selected items.

The behavior is configured through `ContextSelectorOptions`.

## Tuning

All tunable values are centralized in `constants.ts`, including:

- default and maximum budgets;
- score boosts;
- mode multipliers;
- diversity weights;
- representation estimates and quality values;
- excluded path segments;
- stable component IDs and messages.

The selector classes contain behavior, not hidden tuning values.
