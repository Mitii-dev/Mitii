import type { ToolGrant } from "../../decision-policy";
import type { ModelToolDefinition } from "../../model-gateway";

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
