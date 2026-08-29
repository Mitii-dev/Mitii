# Code Navigation

Code Navigation resolves source navigation requests such as definitions, references, and hover information. It is a read-only module that can be exposed as a tool through Tool Runtime when policy grants it.

## What This Module Does

- Validates navigation input.
- Calls an injected `CodeNavigationPort`.
- Resolves definition/reference locations or hover content.
- Caps returned locations.
- Provides fallback/unavailable results when no navigation port is configured.

## Structure

```text
code-navigation/
  pipeline/                 CodeNavigationPipeline
  adapters/                 Graph and fallback adapters
  contracts/
    input/                  CodeNavigationInput
    output/                 CodeNavigationResult
    ports/                  CodeNavigationPort
    errors/                 CodeNavigationError
  tests/
```

## Types And Contracts

- `CodeNavigationInput`: schema version, operation, query, and maximum locations.
- `CodeNavigationQuery`: root id, relative path, line, column, optional symbol name, and declaration flag.
- `CodeNavigationLocation`: returned file/range/symbol/preview data.
- `CodeNavigationHover`: hover contents and optional language.
- `CodeNavigationResult`: status, operation, provider, locations, optional hover, warnings, and reason codes.
- `CodeNavigationPort`: host adapter for definition/reference/hover.

## Technical Details

- The public facade method is `CodeNavigationPipeline.navigate`.
- Operations include definition, references, and hover.
- `GraphCodeNavigationAdapter` can use repository graph data.
- `FallbackCodeNavigationAdapter` provides degraded behavior.
- The module is read-only and never mutates workspace files.

## Ownership Boundaries

Owns navigation query/result contracts and adapter normalization.

Does not own repository indexing, graph building, tool authorization, model prompting, or mutation.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/code-navigation
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

CodeNavigationInput -> CodeNavigationResult:

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

Code Navigation result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "resolved",
  "operation": "references",
  "provider": "repo_graph",
  "locations": [
    { "rootId": "root", "relativePath": "src/LoginForm.tsx", "startLine": 14, "endLine": 38, "symbolName": "LoginForm", "symbolKind": "function", "preview": "export function LoginForm() {" },
    { "rootId": "root", "relativePath": "src/LoginForm.test.tsx", "startLine": 8, "symbolName": "LoginForm", "preview": "render(<LoginForm />);" }
  ],
  "warnings": [],
  "reasonCodes": ["references_resolved", "repo_graph_fallback"]
}
```
