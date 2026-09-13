import type { ToolGrant } from "../../../modules/decision-policy";
import type { ModelToolDefinition } from "../../../modules/model-gateway";
import {
  filterToolsByMcpAttach,
  MCP_TOOL_NAME_PREFIX,
} from "../../../modules/mcp-attach";

import { DEFAULT_READ_ONLY_TOOL_DEFINITIONS } from "../policy";

export { MCP_TOOL_NAME_PREFIX };

/** Meta-tool that hydrates full schemas for granted tools. */
export const DESCRIBE_TOOL_NAME = "describe_tool";

/**
 * Built-ins that keep full model-facing schemas (not INDEX stubs).
 * Progressive disclosure still stubs long-tail / MCP tools so catalogs stay small.
 * Core discovery + mutation must advertise real params — models otherwise guess
 * Cursor/ripgrep shapes (`pattern`, `command`) and fail validation.
 */
export const FULL_SCHEMA_TOOL_IDS: ReadonlySet<string> = new Set([
  DESCRIBE_TOOL_NAME,
  "read_file",
  "read_many_files",
  "search_files",
  "glob_files",
  "list_directory",
  "directory_tree",
  "file_metadata",
  "run_readonly_command",
  "run_command",
  "apply_patch",
  "delete_file",
  "delete_directory",
  "move_file",
  "update_todos",
]);

/** Stub schema advertised for index entries (full schema via describe_tool). */
export const TOOL_INDEX_INPUT_SCHEMA: Readonly<Record<string, unknown>> = {
  type: "object",
  description:
    "Index stub. Call describe_tool with this tool's name to load the full parameter schema before use when needed. Tool Runtime still validates real arguments.",
  properties: {},
};

const INDEX_DESCRIPTION_MAX = 160;

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_NAME_PREFIX);
}

/**
 * Whether host MCP tools may appear under this grant.
 * - write: always (Agent execute)
 * - read + agent: yes (repository_answer still needs MCP Apps like Excalidraw)
 * - read + ask/plan: no
 * - none: no
 */
export function isMcpAllowedByGrant(
  grant: Pick<ToolGrant, "allowedTools" | "maximumWorkspaceEffect">,
  options?: { mode?: "ask" | "plan" | "agent" },
): boolean {
  if (grant.allowedTools.length === 0) {
    return false;
  }
  if (grant.maximumWorkspaceEffect === "write") {
    return true;
  }
  if (grant.maximumWorkspaceEffect === "read") {
    return options?.mode === "agent";
  }
  return false;
}

/**
 * Compact model-facing index entry (progressive disclosure).
 * Core discovery/mutation keep full schemas; long-tail + MCP stay INDEX stubs
 * (hydrate via describe_tool). Execution always uses Tool Runtime Zod schemas.
 */
export function toToolIndexDefinition(
  tool: ModelToolDefinition,
): ModelToolDefinition {
  if (FULL_SCHEMA_TOOL_IDS.has(tool.name)) {
    return tool;
  }
  const description =
    tool.description.length <= INDEX_DESCRIPTION_MAX
      ? tool.description
      : `${tool.description.slice(0, INDEX_DESCRIPTION_MAX - 1)}…`;
  return {
    name: tool.name,
    description,
    inputSchema: TOOL_INDEX_INPUT_SCHEMA,
    ...(tool.requiresWorkspaceWrite
      ? { requiresWorkspaceWrite: true }
      : {}),
  };
}

/**
 * Filter tool definitions by grant, then project to progressive INDEX stubs.
 * Always includes describe_tool when any tools are granted so the model can
 * hydrate full schemas. Model text cannot broaden the set.
 *
 * Host-registered MCP tools (`mcp__*`) are exposed on Agent write grants, and
 * on Agent read grants when the tool does not require workspace writes.
 * Optional `requiredMcpServerIds` / `grant.allowedMcpServerIds` scopes which
 * servers appear (empty = all enabled MCP tools under the grant).
 */
export function filterToolDefinitions(params: {
  grant: ToolGrant;
  definitions?: readonly ModelToolDefinition[];
  supportsTools: boolean;
  mode?: "ask" | "plan" | "agent";
  requiredMcpServerIds?: readonly string[];
}): ModelToolDefinition[] {
  if (!params.supportsTools || params.grant.allowedTools.length === 0) {
    return [];
  }

  const allowed = new Set(params.grant.allowedTools);
  const catalog = params.definitions ?? DEFAULT_READ_ONLY_TOOL_DEFINITIONS;
  const mcpAllowed = isMcpAllowedByGrant(params.grant, { mode: params.mode });
  const writeGrant = params.grant.maximumWorkspaceEffect === "write";
  const attachIds =
    params.requiredMcpServerIds ??
    params.grant.allowedMcpServerIds ??
    undefined;

  const filtered = catalog.filter((tool) => {
    if (allowed.has(tool.name)) {
      return true;
    }
    if (!mcpAllowed || !isMcpToolName(tool.name)) {
      return false;
    }
    if (!writeGrant && tool.requiresWorkspaceWrite) {
      return false;
    }
    return true;
  });

  const scoped = filterToolsByMcpAttach(filtered, attachIds);
  const indexed = scoped.map(toToolIndexDefinition);

  if (
    allowed.has(DESCRIBE_TOOL_NAME) &&
    !indexed.some((tool) => tool.name === DESCRIBE_TOOL_NAME)
  ) {
    const describe =
      catalog.find((tool) => tool.name === DESCRIBE_TOOL_NAME) ??
      DESCRIBE_TOOL_FALLBACK;
    indexed.unshift(describe);
  }

  return indexed;
}

const DESCRIBE_TOOL_FALLBACK: ModelToolDefinition = {
  name: DESCRIBE_TOOL_NAME,
  description:
    "Load the full parameter JSON Schema for one granted tool by name.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Exact tool name from the index." },
    },
    required: ["name"],
  },
};
