# Code Navigation

Read-only source navigation: definitions, references, hover, symbols,
implementations, and call hierarchy.

Hosts inject a `CodeNavigationPort`. This module validates input, caps results,
and returns stable reason codes. It does not spawn language servers or own
repository indexing.

## Facade

`CodeNavigationPipeline.navigate(input) → CodeNavigationResult`

| Operation | Typical tool alias |
|---|---|
| `definition` | `goto_definition` |
| `type_definition` | `find_type_definition` |
| `references` | `find_references` |
| `hover` | `hover_symbol` |
| `document_symbols` | `document_symbol` |
| `workspace_symbols` | `workspace_symbol` |
| `implementation` | `find_implementation` |
| `call_hierarchy` | `call_hierarchy` |

## Consumers

- Tool Runtime — maps agent tools to `navigate`
- Change Impact — may merge navigation hits when a graph walk is thin
- Hosts — implement `CodeNavigationPort` (editor providers, language services, stdio, or repo graph)

## Layout

```text
code-navigation/
  pipeline/     CodeNavigationPipeline
  adapters/     Graph + fallback ports
  contracts/    input, output, port, errors
  internal/     result builders, request limiter
  tests/
```

## Contracts

- **Input:** `schemaVersion`, `operation`, `query`, optional `maximumLocations`
- **Query:** caret (`relativePath` + `line` + `column`), document path, or workspace symbol string
- **Output:** `status` (`resolved` | `empty` | `unavailable`), `provider`, locations and/or hover, `truncated`, `warnings`, `reasonCodes`
- **Capability:** hosts report `available` | `degraded` | `unavailable`

## Notes

- Graph `implementation` walks `implements` / `extends`; call hierarchy walks `calls`. Language-service ports are preferred when attached; graph is degraded fallback.
- `FallbackCodeNavigationAdapter` tries the primary port, then the graph.
- Defaults (`maximumLocations`, hover size, hop depth, request limit/timeout) are navigation caps — not model context-window policy.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/code-navigation
```

## Example

```json
{
  "schemaVersion": 1,
  "operation": "definition",
  "query": {
    "relativePath": "src/auth.ts",
    "line": 4,
    "column": 10,
    "symbolName": "validateJwt"
  },
  "maximumLocations": 40
}
```

Missing port or provider failure yields `unavailable` with stable reason codes — not a thrown soft miss.
