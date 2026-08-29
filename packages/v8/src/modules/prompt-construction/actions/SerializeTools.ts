import type { ExecutionDecision } from "../../decision-policy";
import {
  MUTATION_TOOL_IDS,
  PROCESS_TOOL_IDS,
} from "../../decision-policy/constants";
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

/** Tools that must stay callable when a write grant includes them. */
const WRITE_CRITICAL_TOOL_IDS = new Set<string>([
  ...MUTATION_TOOL_IDS,
  ...PROCESS_TOOL_IDS,
  "update_todos",
]);

/**
 * Pack order when the tools section budget is tight. Higher = keep first.
 * Write-critical tools outrank optional discovery/nav so execute+write never
 * advertises apply_patch in prose while omitting its schema.
 */
const TOOL_PACK_PRIORITY: Record<string, number> = {
  apply_patch: 100,
  delete_file: 95,
  delete_directory: 94,
  move_file: 93,
  run_command: 90,
  update_todos: 85,
  read_file: 70,
  read_many_files: 69,
  search_files: 65,
  glob_files: 64,
  list_directory: 63,
  file_metadata: 60,
  run_readonly_command: 55,
  read_diagnostics: 50,
  read_git_status: 49,
  read_package_scripts: 48,
  analyze_change_impact: 40,
  goto_definition: 35,
  find_references: 34,
};

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

  const ordered = [...filtered].sort((left, right) => {
    const priorityDelta =
      packPriority(right.name) - packPriority(left.name);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return left.name.localeCompare(right.name);
  });

  const included: ModelToolDefinition[] = [];
  let usedTokens = 0;
  let omittedTokens = 0;
  let remaining = params.budgetTokens;

  for (const tool of ordered) {
    const tokens = estimateTool(tool, params.estimator);
    const critical =
      mcpWritable &&
      WRITE_CRITICAL_TOOL_IDS.has(tool.name) &&
      grantTools.has(tool.name);

    if (tokens <= remaining || critical) {
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

function packPriority(name: string): number {
  if (name.startsWith("mcp__")) {
    return 75;
  }
  return TOOL_PACK_PRIORITY[name] ?? 45;
}

function estimateTool(
  tool: ModelToolDefinition,
  estimator: TokenEstimatorPort,
): number {
  return estimator.estimate(
    `${tool.name}\n${tool.description}\n${JSON.stringify(tool.inputSchema)}`,
  );
}
