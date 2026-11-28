# Code Navigation

"Go to definition" for the agent: ask where a symbol lives, who uses it, or what it is.

## Does
- Resolves definitions, type definitions, references, hover, document / workspace symbols, implementations, and call hierarchy.
- Delegates to an injected navigation port and applies result caps.
- Ships a repo-graph adapter and a fallback adapter that can be chained behind a language-server port.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `CodeNavigationInput` (`operation`, `query` with file / line / column / symbol name, `maximumLocations`).
**Output:** `CodeNavigationResult` (status, locations or symbols, reason codes).
**Pipeline:** `CodeNavigationPipeline` stages: `1-resolve-port` → `2-prepare-document` → `3-execute-operation` → `4-build-result`
**Ports we offer / need:** needs `CodeNavigationPort` (`definition`, `references`, plus optional operations and capability reporting; provider is `language_server` or `repo_graph`). Adapters fulfill it (`GraphCodeNavigationAdapter`, `FallbackCodeNavigationAdapter`). Optional `ModuleLoggerPort`.

## Dependencies
**Upstream (this module uses):** repository-state (graph and state types).
**Downstream (who uses this):** the engine / tool-runtime (go-to-definition, references, and change-impact navigation enrichment).

## How to use
```ts
import { CodeNavigationPipeline } from "@mitii/v8/modules/code-navigation";

const nav = new CodeNavigationPipeline({ navigation: hostPort });
const result = await nav.navigate(input);
```

## Example
Input:
```json
{
  "schemaVersion": 1,
  "operation": "definition",
  "query": { "relativePath": "src/auth.ts", "line": 4, "column": 10, "symbolName": "validateJwt" },
  "maximumLocations": 40
}
```
Output (illustrative, abbreviated):
```json
{ "status": "ok", "locations": [{ "relativePath": "src/jwt.ts", "line": 12, "column": 17 }] }
```

## Non-responsibilities
Does not start language servers or own repository indexing.
