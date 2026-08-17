# Context Assembly

Context Assembly turns selected context items into prompt-safe content blocks. It loads content, applies safety policies, truncates to budget, and returns blocks with provenance.

## What This Module Does

- Validates assembly input.
- Loads content through registered content sources.
- Applies sensitive-path policy.
- Redacts common secret patterns.
- Sanitizes unsafe/control text.
- Applies line ranges and representation decisions.
- Truncates content to budget.
- Produces context blocks, dropped blocks, warnings, budget usage, and statistics.

## Structure

```text
context-assembly/
  ContextAssembler.ts
  ContextContentLoader.ts
  ContextContentSourceRegistry.ts
  WorkspaceFileContextSource.ts
  SelectedPreviewContextSource.ts
  ContextBlockBuilder.ts
  ContextSecretRedactor.ts
  ContextTextSanitizer.ts
  ContextTextTruncator.ts
  schema.ts
  types.ts
  tests/
```

## Types And Contracts

- `ContextAssemblyInput`: selection result, workspace snapshot, optional `folderPrefix`, and optional abort signal.
- `ContextContentSource`: loader contract for workspace files, previews, or future sources.
- `ContextBlock`: prompt-safe assembled content with path, line ranges, token estimate, truncation, redaction, and provenance.
- `DroppedContextBlock`: selected item that could not be assembled with a cause.
- `ContextAssemblyResult`: status, blocks, dropped blocks, warnings, budget usage, and statistics.
- `ContextAssemblyFactoryDependencies`: dependencies for building an assembler module.

## Technical Details

- `WorkspaceFileContextSource` reads file content from snapshot-backed file sources.
- `SelectedPreviewContextSource` can use candidate preview text without another file read.
- Redaction and sanitization happen before prompt construction sees content.
- Truncation preserves metadata and reports omitted characters/tokens.
- Block ids are stable and derived from provenance.

## Ownership Boundaries

Owns content loading, redaction, sanitization, truncation, and context block creation.

Does not own retrieval ranking, selection scoring, prompt section budgeting, or model calls.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/repository-context/internal/context-assembly
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

ContextAssemblyInput -> ContextAssemblyResult:

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

Context Assembly result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "complete",
  "blocks": [
    {
      "id": "repo:src/LoginForm.tsx:1-120",
      "relativePath": "src/LoginForm.tsx",
      "content": "export function LoginForm() {\n  const [isSubmitting, setIsSubmitting] = useState(false);\n  ...\n}",
      "lineRanges": [{ "startLine": 1, "endLine": 120 }],
      "tokenEstimate": 1320,
      "truncated": false,
      "redactions": []
    }
  ],
  "dropped": [],
  "warnings": [],
  "budget": { "maximumTokens": 6000, "usedTokens": 1320, "remainingTokens": 4680 },
  "statistics": { "loadedItems": 1, "blocks": 1, "droppedBlocks": 0 }
}
```
