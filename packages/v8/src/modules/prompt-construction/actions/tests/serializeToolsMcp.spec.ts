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
    expect(result.tools?.map((t) => t.name).sort()).toEqual(
      ["mcp__memory__store", "read_file"].sort(),
    );
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

  it("keeps apply_patch under a tight tools budget by dropping lower-priority tools", () => {
    const fatCatalog: ModelToolDefinition[] = [
      {
        name: "apply_patch",
        description: "patch",
        inputSchema: {
          type: "object",
          properties: { patches: { type: "array" } },
        },
      },
      {
        name: "goto_definition",
        description: "nav",
        inputSchema: {
          type: "object",
          properties: { symbol: { type: "string" } },
        },
      },
      {
        name: "find_references",
        description: "refs",
        inputSchema: {
          type: "object",
          properties: { symbol: { type: "string" } },
        },
      },
      {
        name: "read_file",
        description: "read",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
    ];
    const applyTokens = estimator.estimate(
      `apply_patch\npatch\n${JSON.stringify(fatCatalog[0]!.inputSchema)}`,
    );
    const result = serializeTools({
      decision: decision({
        allowedTools: [
          "apply_patch",
          "read_file",
          "goto_definition",
          "find_references",
        ],
      }),
      tools: fatCatalog,
      capabilities,
      estimator,
      budgetTokens: applyTokens + 20,
    });
    const names = result.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain("apply_patch");
    expect(result.omissions.some((item) => item.detail === "budget")).toBe(
      true,
    );
  });
});
