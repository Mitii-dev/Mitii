# Context Selection

Context Selection chooses the best subset of retrieval candidates under token, item, file, and diversity budgets. It is the second internal stage of Repository Context.

## What This Module Does

- Normalizes selection input and budgets.
- Converts retrieval candidates into prepared context candidates.
- Scores candidates with query, path, symbol, source, and reference signals.
- Honors pinned files and editor selections.
- Applies diversity ranking so one source/file does not dominate.
- Chooses representation plans for selected items.
- Reports selected and dropped items with reasons.

## Structure

```text
context-selection/
  ContextSelector.ts
  ContextCandidatePreparer.ts
  ContextSelectionScorer.ts
  ContextDiversityRanker.ts
  ContextBudgetAllocator.ts
  ContextRepresentationPolicy.ts
  ContextPathMatcher.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `ContextSelectionInput`: query, retrieval result, optional mode, breadth, references, budget, and abort signal.
- `ContextSelectionBudget`: maximum tokens/items/files/items-per-file, minimum items, and minimum score.
- `ContextSelectionReferences`: pinned file references and editor selections.
- `ContextCandidate`: normalized candidate considered for selection.
- `SelectedContextItem`: selected item with representation, score, provenance, and budget data.
- `DroppedContextItem`: skipped candidate with reason.
- `ContextSelectionResult`: selected items, dropped items, warnings, budget usage, and statistics.

## Technical Details

- Breadth can be focused, balanced, or broad.
- Pinned references can synthesize required items.
- Token estimates drive selection before file content is loaded.
- Representation policy decides whether to show symbol, excerpt, file preview, or compact reference.
- Diversity ranking balances files, roots, sources, and candidate kinds.

## Ownership Boundaries

Owns scoring, ranking, diversity, budget allocation, and selected/dropped item reporting.

Does not own source retrieval, content loading, redaction, or prompt section allocation.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-context/internal/context-selection
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

ContextSelectionInput -> ContextSelectionResult:

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

Context Selection result returns a result like this:

```json
{
  "schemaVersion": 1,
  "query": "Add a loading state to the login button in src/LoginForm.tsx.",
  "mode": "agent",
  "breadth": "focused",
  "status": "complete",
  "items": [
    { "selectionKey": "path:src/LoginForm.tsx", "relativePath": "src/LoginForm.tsx", "score": 0.98, "required": true, "representation": { "kind": "file_excerpt" } },
    { "selectionKey": "path:src/LoginForm.test.tsx", "relativePath": "src/LoginForm.test.tsx", "score": 0.74, "representation": { "kind": "file_excerpt" } }
  ],
  "dropped": [{ "selectionKey": "path:src/Unused.tsx", "reason": "lower_score" }],
  "warnings": [],
  "budget": { "maximumTokens": 6000, "usedTokens": 1880, "remainingTokens": 4120, "maximumItems": 8, "maximumFiles": 5 },
  "statistics": { "retrievedCandidates": 6, "selectedItems": 2, "droppedItems": 4, "selectedFiles": 2 }
}
```
