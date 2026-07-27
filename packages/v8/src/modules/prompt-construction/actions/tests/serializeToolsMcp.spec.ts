import { describe, expect, it } from "vitest";

import { serializeTools } from "../SerializeTools";
import type { ExecutionDecision } from "../../../decision-policy";
import type { ModelCapabilities, ModelToolDefinition } from "../../../model-gateway";
import type { TokenEstimatorPort } from "../../contracts";

const estimator: TokenEstimatorPort = {
  estimate: (text) => Math.max(1, Math.ceil(text.length / 4)),
};

function decision(partial: Partial<ExecutionDecision["toolGrant"]>): ExecutionDecision {
  return {
    schemaVersion: 1,
    route: "execute",
    planningDepth: "none",
    runDisposition: "continue",
    reasonCodes: [],
    toolGrant: {
      maximumWorkspaceEffect: "write",
      allowedTools: ["read_file", "apply_patch"],
      allowedEffects: ["workspace_read", "workspace_write"],
      pathScopes: ["."],
      approvalMode: "when_required",
      limits: {
        maxToolCalls: 20,
        maxConcurrentToolCalls: 1,
        maxWallTimeMs: 60_000,
        maxOutputBytesPerCall: 64_000,
      },
      ...partial,
    },
  } as ExecutionDecision;
}

const capabilities: ModelCapabilities = {
  modelId: "test",
  contextWindowTokens: 8_192,
  maximumOutputTokens: 2_048,
  supportsStreaming: true,
  supportsTools: true,
  supportsParallelToolCalls: false,
  supportsStructuredOutput: false,
  supportsVision: false,
  supportsReasoning: false,
  supportsPromptCaching: false,
  supportsEmbeddings: false,
};

const catalog: ModelToolDefinition[] = [
  { name: "read_file", description: "read", inputSchema: { type: "object" } },
  {
    name: "mcp__memory__store",
    description: "mcp",
    inputSchema: { type: "object" },
  },
  {
    name: "search_files",
    description: "search",
    inputSchema: { type: "object" },
  },
];

describe("serializeTools MCP parity", () => {
  it("keeps mcp__* tools when write is granted", () => {
    const result = serializeTools({
      decision: decision({ maximumWorkspaceEffect: "write" }),
      tools: catalog,
      capabilities,
      estimator,
      budgetTokens: 10_000,
    });
    expect(result.tools?.map((t) => t.name)).toEqual([
      "read_file",
      "mcp__memory__store",
    ]);
  });

  it("strips mcp__* tools on read grants", () => {
    const result = serializeTools({
      decision: decision({
        maximumWorkspaceEffect: "read",
        allowedTools: ["read_file"],
        allowedEffects: ["workspace_read"],
        approvalMode: "never",
      }),
      tools: catalog,
      capabilities,
      estimator,
      budgetTokens: 10_000,
    });
    expect(result.tools?.map((t) => t.name)).toEqual(["read_file"]);
  });
});
