/**
 * Shim — progressive filter owned by runtime/helpers/progressive-tools.
 * Injects DEFAULT_READ_ONLY_TOOL_DEFINITIONS when callers omit `definitions`.
 */
import type { ToolGrant } from "../../../modules/decision-policy";
import type { ModelToolDefinition } from "../../../modules/model-gateway";
import { DEFAULT_READ_ONLY_TOOL_DEFINITIONS } from "../legacy/policy";
import {
  filterToolDefinitions as filterToolDefinitionsRuntime,
} from "../../../runtime/helpers/progressive-tools";

export {
  MCP_TOOL_NAME_PREFIX,
  DESCRIBE_TOOL_NAME,
  CORE_DISCOVERY_FULL_SCHEMA_TOOL_IDS,
  CORE_MUTATION_FULL_SCHEMA_TOOL_IDS,
  buildFullSchemaToolIds,
  FULL_SCHEMA_TOOL_IDS,
  TOOL_INDEX_INPUT_SCHEMA,
  isMcpToolName,
  isMcpAllowedByGrant,
  toToolIndexDefinition,
} from "../../../runtime/helpers/progressive-tools";

export function filterToolDefinitions(params: {
  grant: ToolGrant;
  definitions?: readonly ModelToolDefinition[];
  supportsTools: boolean;
  mode?: "ask" | "plan" | "agent";
  requiredMcpServerIds?: readonly string[];
  fullSchemaToolIds?: ReadonlySet<string>;
}): ModelToolDefinition[] {
  return filterToolDefinitionsRuntime({
    ...params,
    definitions: params.definitions ?? DEFAULT_READ_ONLY_TOOL_DEFINITIONS,
  });
}
