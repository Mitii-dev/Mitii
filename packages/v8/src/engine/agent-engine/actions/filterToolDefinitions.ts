import type { ToolGrant } from "../../../modules/decision-policy";
import {
  CHANGE_IMPACT_TOOL_IDS,
  CODE_INTELLIGENCE_TOOL_IDS,
  DIAGNOSTICS_TOOL_IDS,
  MUTATION_TOOL_IDS,
} from "../../../modules/decision-policy";
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
 * Discovery and filesystem inspection tools that keep full progressive schemas.
 * Derived families (code intelligence, diagnostics, change-impact, mutation)
 * are composed in {@link buildFullSchemaToolIds} — do not hardcode those IDs here.
 */
export const CORE_DISCOVERY_FULL_SCHEMA_TOOL_IDS = [
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
  "update_todos",
] as const;

/** Mutation tools that keep full progressive schemas (workspace write surface). */
export const CORE_MUTATION_FULL_SCHEMA_TOOL_IDS = MUTATION_TOOL_IDS.filter(
  (id) => id !== "memory_graph_update",
);

/**
 * Build the progressive-disclosure full-schema allowlist from tool families.
 * Callers may pass extra families for host/extension tools without editing
 * the core set.
 */
export function buildFullSchemaToolIds(
  extraFamilies: ReadonlyArray<ReadonlyArray<string>> = [],
): ReadonlySet<string> {
  const ids = new Set<string>([
    ...CORE_DISCOVERY_FULL_SCHEMA_TOOL_IDS,
    ...CORE_MUTATION_FULL_SCHEMA_TOOL_IDS,
    ...CODE_INTELLIGENCE_TOOL_IDS,
    ...DIAGNOSTICS_TOOL_IDS,
    ...CHANGE_IMPACT_TOOL_IDS,
  ]);
  for (const family of extraFamilies) {
    for (const id of family) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Built-ins that keep full schemas (not INDEX stubs).
 * Progressive disclosure still stubs long-tail / MCP tools so catalogs stay small.
 * Code intelligence, diagnostics, and change-impact are first-class families.
 */
export const FULL_SCHEMA_TOOL_IDS: ReadonlySet<string> = buildFullSchemaToolIds();

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
 * Compact progressive-disclosure index entry.
 * Core discovery / mutation / code-intelligence keep full schemas; long-tail
 * and MCP stay INDEX stubs (hydrate via describe_tool). Execution always uses
 * Tool Runtime Zod schemas.
 */
export function toToolIndexDefinition(
  tool: ModelToolDefinition,
  fullSchemaIds: ReadonlySet<string> = FULL_SCHEMA_TOOL_IDS,
): ModelToolDefinition {
  if (fullSchemaIds.has(tool.name)) {
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
 * Always includes describe_tool when any tools are granted so full schemas can
 * be hydrated. Grant text cannot broaden the set.
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
  /** Optional override / extension of the full-schema family set. */
  fullSchemaToolIds?: ReadonlySet<string>;
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
  const fullSchemaIds = params.fullSchemaToolIds ?? FULL_SCHEMA_TOOL_IDS;

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
  const indexed = scoped.map((tool) =>
    toToolIndexDefinition(tool, fullSchemaIds),
  );

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
