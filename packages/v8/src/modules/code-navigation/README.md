# Code Navigation

```text
Input:  CodeNavigationInput { operation, query { relativePath, line, column, symbolName? } }
Output: CodeNavigationResult { status, provider, locations[], hover?, reasonCodes }
```

Resolves go-to-definition, find-references, and hover through an injected
`CodeNavigationPort`. Hosts supply a language-server adapter (VS Code) and/or
the graph fallback (`GraphCodeNavigationAdapter`).

Does not own indexing, retrieval budgets, or tool grants.

## Pipeline stages

1. Validate input
2. Call the injected port
3. Bound locations
4. Return a discriminated status (`resolved` | `empty` | `unavailable`)

## Ports

| Port | Owner |
|------|--------|
| `CodeNavigationPort` | Host (VS Code `executeDefinitionProvider` / CLI graph) |

## Public exports

| Export | Role |
|--------|------|
| `CodeNavigationPipeline` | Facade |
| `GraphCodeNavigationAdapter` | Repo-graph fallback |
| `FallbackCodeNavigationAdapter` | Language server then graph |
| `codeNavigationInputSchema` / `codeNavigationResultSchema` | Boundary |

## Failure modes

- Missing port → `unavailable` / `port_unavailable`
- Language server throw → `language_server_unavailable` (fallback adapter may still resolve via graph)
- No symbol at the caret → `empty` / `no_locations`

## Genericness

No language-specific queries in this module. Parsers and LSPs stay in host
adapters and repository-state source analysis.
