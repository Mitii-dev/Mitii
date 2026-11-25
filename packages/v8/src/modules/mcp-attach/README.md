# MCP Attach

**Does:** per-turn MCP server scoping from `@mcp:id` mentions and host pins — parse, merge, filter tools, stamp grants, format a project-rule hint. Does not connect MCP clients or enforce grants.

## Contract

```text
message + optional host pins
  → McpAttachPipeline.resolveAttachList()
  → { cleanedMessage, requiredMcpServerIds }

requiredMcpServerIds
  → filterTools / stampGrant / formatInstruction
```

| Attach list | Effect on `mcp__*` tools |
|---|---|
| empty / omitted | all grant-allowed MCP tools stay visible |
| non-empty | only `mcp__{attachedServer}__*` tools stay visible |

## Example

```ts
const attach = new McpAttachPipeline();

const { cleanedMessage, requiredMcpServerIds } = attach.resolveAttachList({
  message: "@mcp:memory Draw the billing flow",
  explicitIds: ["filesystem"],
});
// cleanedMessage === "Draw the billing flow"
// requiredMcpServerIds === ["filesystem", "memory"]  (pins first, then mentions)

const tools = attach.filterTools(
  [
    { name: "read_file" },
    { name: "mcp__memory__store" },
    { name: "mcp__other__x" },
  ],
  requiredMcpServerIds,
);
// keeps read_file + mcp__memory__store (filesystem has no tools in this catalog)
```
