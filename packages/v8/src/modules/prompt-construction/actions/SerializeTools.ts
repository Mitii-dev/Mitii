import type { ExecutionDecision } from "../../decision-policy";
import type {
  ModelCapabilities,
  ModelToolChoice,
  ModelToolDefinition,
} from "../../model-gateway";

import type { TokenEstimatorPort } from "../contracts";

export interface SerializedTools {
  tools: ModelToolDefinition[] | undefined;
  toolChoice: ModelToolChoice | undefined;
  usedTokens: number;
  omittedTokens: number;
  omissions: Array<{
    source: string;
    tokens: number;
    detail: string;
  }>;
  reasonCodes: Array<
    "tools_omitted_unsupported" | "tools_filtered_by_grant" | "grant_empty"
  >;
}

export function serializeTools(params: {
  decision: ExecutionDecision;
  tools: readonly ModelToolDefinition[] | undefined;
  capabilities: ModelCapabilities;
  estimator: TokenEstimatorPort;
  budgetTokens: number;
}): SerializedTools {
  const grantTools = new Set(params.decision.toolGrant.allowedTools);
  const reasonCodes: SerializedTools["reasonCodes"] = [];
  const omissions: SerializedTools["omissions"] = [];
  const mcpWritable =
    params.decision.toolGrant.maximumWorkspaceEffect === "write";

  if (
    grantTools.size === 0 ||
    params.decision.toolGrant.maximumWorkspaceEffect === "none"
  ) {
    reasonCodes.push("grant_empty");
    return {
      tools: undefined,
      toolChoice: undefined,
      usedTokens: 0,
      omittedTokens: 0,
      omissions,
      reasonCodes,
    };
  }

  if (!params.capabilities.supportsTools) {
    reasonCodes.push("tools_omitted_unsupported");
    const supplied = params.tools ?? [];
    const omittedTokens = supplied.reduce(
      (sum, tool) => sum + estimateTool(tool, params.estimator),
      0,
    );
    for (const tool of supplied) {
      omissions.push({
        source: tool.name,
        tokens: estimateTool(tool, params.estimator),
        detail: "capability_unsupported",
      });
    }
    return {
      tools: undefined,
      toolChoice: undefined,
      usedTokens: 0,
      omittedTokens,
      omissions,
      reasonCodes,
    };
  }

  // Keep parity with Agent Engine filterToolDefinitions: mcp__* may pass when
  // write is granted even if not listed in allowedTools.
  const filtered = (params.tools ?? []).filter(
    (tool) =>
      grantTools.has(tool.name) ||
      (mcpWritable && tool.name.startsWith("mcp__")),
  );
  if ((params.tools?.length ?? 0) > filtered.length) {
    reasonCodes.push("tools_filtered_by_grant");
    for (const tool of params.tools ?? []) {
      if (
        !grantTools.has(tool.name) &&
        !(mcpWritable && tool.name.startsWith("mcp__"))
      ) {
        omissions.push({
          source: tool.name,
          tokens: estimateTool(tool, params.estimator),
          detail: "grant_empty",
        });
      }
    }
  }

  const included: ModelToolDefinition[] = [];
  let usedTokens = 0;
  let omittedTokens = 0;
  let remaining = params.budgetTokens;

  for (const tool of filtered) {
    const tokens = estimateTool(tool, params.estimator);
    if (tokens <= remaining) {
      included.push(tool);
      usedTokens += tokens;
      remaining -= tokens;
      continue;
    }
    omissions.push({
      source: tool.name,
      tokens,
      detail: "budget",
    });
    omittedTokens += tokens;
  }

  if (included.length === 0) {
    return {
      tools: undefined,
      toolChoice: undefined,
      usedTokens: 0,
      omittedTokens,
      omissions,
      reasonCodes,
    };
  }

  return {
    tools: included,
    toolChoice: "auto",
    usedTokens,
    omittedTokens,
    omissions,
    reasonCodes,
  };
}

function estimateTool(
  tool: ModelToolDefinition,
  estimator: TokenEstimatorPort,
): number {
  return estimator.estimate(
    `${tool.name}\n${tool.description}\n${JSON.stringify(tool.inputSchema)}`,
  );
}
