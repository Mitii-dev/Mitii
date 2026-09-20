import type { ExecutionDecision } from "../../decision-policy";
import {
  CHANGE_IMPACT_TOOL_IDS,
  CODE_INTELLIGENCE_TOOL_IDS,
  DIAGNOSTICS_TOOL_IDS,
  MUTATION_TOOL_IDS,
  PROCESS_TOOL_IDS,
} from "../../decision-policy/constants";
import type {
  ModelCapabilities,
  ModelToolChoice,
  ModelToolDefinition,
} from "../../model-gateway";
import {
  isMcpToolAttached,
  MCP_TOOL_NAME_PREFIX,
} from "../../mcp-attach";

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
 * Base priorities for named tools. Family defaults (code intelligence,
 * diagnostics, change-impact) are applied in {@link packPriority} so new
 * family members inherit the correct band without editing this map.
 *
 * Pack order when the tools section budget is tight. Higher = keep first.
 * Write-critical tools outrank optional discovery so execute+write never
 * advertises apply_patch in prose while omitting its schema.
 * Code-intelligence sits above text search so symbol tools survive packing.
 */
const TOOL_PACK_PRIORITY: Record<string, number> = {
  describe_tool: 110,
  apply_patch: 100,
  delete_file: 95,
  delete_directory: 94,
  move_file: 93,
  run_command: 90,
  update_todos: 85,
  read_file: 70,
  read_many_files: 69,
  // Code-intelligence band: 68..62 (see family defaults below)
  search_files: 61,
  glob_files: 60,
  list_directory: 59,
  file_metadata: 58,
  run_readonly_command: 55,
  // Diagnostics / change-impact band applied via families
  read_git_status: 49,
  read_package_scripts: 48,
};

/** Preferred order inside the code-intelligence family (higher first). */
const CODE_INTELLIGENCE_PACK_ORDER: readonly string[] = [
  "document_symbol",
  "goto_definition",
  "find_references",
  "find_implementation",
  "call_hierarchy",
  "hover_symbol",
  "workspace_symbol",
];

const CODE_INTELLIGENCE_PRIORITY_BASE = 68;
const DIAGNOSTICS_PRIORITY = 66;
const CHANGE_IMPACT_PRIORITY = 65;
const DEFAULT_PACK_PRIORITY = 45;
const MCP_PACK_PRIORITY = 75;

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
  const mcpAllowed =
    params.decision.toolGrant.maximumWorkspaceEffect === "write" ||
    params.decision.toolGrant.maximumWorkspaceEffect === "read";

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
  // a read/write grant has a tool belt; attach list further scopes servers.
  const filtered = (params.tools ?? []).filter(
    (tool) =>
      grantTools.has(tool.name) ||
      (mcpAllowed &&
        tool.name.startsWith(MCP_TOOL_NAME_PREFIX) &&
        isMcpToolAttached(
          tool.name,
          params.decision.toolGrant.allowedMcpServerIds,
        )),
  );
  if ((params.tools?.length ?? 0) > filtered.length) {
    reasonCodes.push("tools_filtered_by_grant");
    for (const tool of params.tools ?? []) {
      if (
        !grantTools.has(tool.name) &&
        !(
          mcpAllowed &&
          tool.name.startsWith(MCP_TOOL_NAME_PREFIX) &&
          isMcpToolAttached(
            tool.name,
            params.decision.toolGrant.allowedMcpServerIds,
          )
        )
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

  const writeGrant =
    params.decision.toolGrant.maximumWorkspaceEffect === "write";
  for (const tool of ordered) {
    const tokens = estimateTool(tool, params.estimator);
    const critical =
      writeGrant &&
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

/** Exported for tests — family-aware pack priority. */
export function packPriority(name: string): number {
  if (name.startsWith("mcp__")) {
    return MCP_PACK_PRIORITY;
  }
  if (Object.prototype.hasOwnProperty.call(TOOL_PACK_PRIORITY, name)) {
    return TOOL_PACK_PRIORITY[name]!;
  }
  if ((DIAGNOSTICS_TOOL_IDS as readonly string[]).includes(name)) {
    return DIAGNOSTICS_PRIORITY;
  }
  if ((CHANGE_IMPACT_TOOL_IDS as readonly string[]).includes(name)) {
    return CHANGE_IMPACT_PRIORITY;
  }
  const codeIntelIndex = CODE_INTELLIGENCE_PACK_ORDER.indexOf(name);
  if (codeIntelIndex >= 0) {
    return CODE_INTELLIGENCE_PRIORITY_BASE - codeIntelIndex;
  }
  if ((CODE_INTELLIGENCE_TOOL_IDS as readonly string[]).includes(name)) {
    return CODE_INTELLIGENCE_PRIORITY_BASE - CODE_INTELLIGENCE_PACK_ORDER.length;
  }
  return DEFAULT_PACK_PRIORITY;
}

function estimateTool(
  tool: ModelToolDefinition,
  estimator: TokenEstimatorPort,
): number {
  return estimator.estimate(
    `${tool.name}\n${tool.description}\n${JSON.stringify(tool.inputSchema)}`,
  );
}
