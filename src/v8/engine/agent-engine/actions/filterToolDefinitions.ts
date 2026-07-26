import type { ToolGrant } from "../../../modules/decision-policy";
import type { ModelToolDefinition } from "../../../modules/model-gateway";

import { DEFAULT_READ_ONLY_TOOL_DEFINITIONS } from "../policy";

/**
 * Filter tool definitions by grant. Model text cannot broaden the set.
 */
export function filterToolDefinitions(params: {
  grant: ToolGrant;
  definitions?: readonly ModelToolDefinition[];
  supportsTools: boolean;
}): ModelToolDefinition[] {
  if (!params.supportsTools || params.grant.allowedTools.length === 0) {
    return [];
  }

  const allowed = new Set(params.grant.allowedTools);
  const catalog = params.definitions ?? DEFAULT_READ_ONLY_TOOL_DEFINITIONS;

  return catalog.filter((tool) => allowed.has(tool.name));
}
