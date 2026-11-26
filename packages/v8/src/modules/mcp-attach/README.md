# MCP Attach

A per-turn guest list: it decides which MCP servers are "invited" this turn and hides the tools of the rest.

## Does
- Parses `@mcp:id` mentions from the user message and merges them with host pins.
- Normalizes server ids and matches tool names to servers.
- Filters the visible tool list to the attached servers.
- Stamps the attach list onto the tool grant.
- Formats a short project-rule hint for the prompt.

## Contract
Works on a contract: validated input in → pipeline/steps → validated output out. Reason codes explain outcomes.

**Input:** `{ message, explicitIds? }` for `resolveAttachList`; then the attach list plus a tool catalog / grant for the other methods.
**Output:** `{ cleanedMessage, requiredMcpServerIds }`, a filtered tool list, a stamped grant, and an instruction block.
**Pipeline:** `McpAttachPipeline` stages: `1-normalize-server-id` → `2-parse-mentions` → `3-merge-server-ids` → `4-match-tool` → `5-filter-tools` → `6-stamp-grant` → `7-format-instruction`
**Ports we offer / need:** none of its own; optional `ModuleLoggerPort`. No adapters are required.

## Dependencies
**Upstream (this module uses):** none.
**Downstream (who uses this):** prompt-construction, and the engine / tool-runtime (start of a turn, grant validation, tool description).

## How to use
```ts
import { McpAttachPipeline } from "@mitii/v8/modules/mcp-attach";

const attach = new McpAttachPipeline();
const { cleanedMessage, requiredMcpServerIds } = attach.resolveAttachList({
  message, explicitIds,
});
const tools = attach.filterTools(allTools, requiredMcpServerIds);
```

## Example
Input:
```json
{ "message": "@mcp:memory Draw the billing flow", "explicitIds": ["filesystem"] }
```
Output:
```json
{ "cleanedMessage": "Draw the billing flow", "requiredMcpServerIds": ["filesystem", "memory"] }
```
With a non-empty list, only `mcp__<attachedServer>__*` tools stay visible; an empty list leaves all allowed MCP tools visible.

## Non-responsibilities
Does not connect MCP clients, run MCP tools, or enforce grants — tool-runtime enforces them.
