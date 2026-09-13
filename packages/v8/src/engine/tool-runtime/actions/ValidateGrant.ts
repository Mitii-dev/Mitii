import type { ToolGrant } from "../../../modules/decision-policy";
import {
  isMcpToolAttached,
  MCP_TOOL_NAME_PREFIX,
} from "../../../modules/mcp-attach";

import type { ToolReasonCode } from "../contracts";
import type { ToolDefinition } from "../internal/ToolCatalog";

export class GrantValidationError extends Error {
  public readonly reasonCode: ToolReasonCode;

  constructor(reasonCode: ToolReasonCode, message: string) {
    super(message);
    this.name = "GrantValidationError";
    this.reasonCode = reasonCode;
  }
}

export function validateToolAgainstGrant(params: {
  tool: ToolDefinition;
  grant: ToolGrant;
}): void {
  const { tool, grant } = params;

  const mcpName = tool.name.startsWith(MCP_TOOL_NAME_PREFIX);
  const mcpEffectOk =
    mcpName &&
    grant.allowedTools.length > 0 &&
    (grant.maximumWorkspaceEffect === "write" ||
      grant.maximumWorkspaceEffect === "read");
  const mcpAttachOk =
    !mcpName || isMcpToolAttached(tool.name, grant.allowedMcpServerIds);
  const mcpAllowed = mcpEffectOk && mcpAttachOk;

  if (!grant.allowedTools.includes(tool.name) && !mcpAllowed) {
    throw new GrantValidationError(
      "tool_not_allowed",
      mcpName && mcpEffectOk && !mcpAttachOk
        ? `MCP tool "${tool.name}" is outside the attached MCP server list.`
        : `Tool "${tool.name}" is not in the grant allowedTools list.`,
    );
  }

  for (const effect of tool.effects) {
    if (!grant.allowedEffects.includes(effect)) {
      throw new GrantValidationError(
        "effect_not_granted",
        `Tool "${tool.name}" requires effect "${effect}" which is not granted.`,
      );
    }
  }

  if (
    tool.effects.includes("network_access") &&
    tool.name !== "web_search" &&
    (!grant.networkHosts || grant.networkHosts.length === 0)
  ) {
    throw new GrantValidationError(
      "network_not_allowed",
      `Tool "${tool.name}" requires networkHosts but none were granted.`,
    );
  }

  if (
    tool.effects.includes("workspace_write") ||
    tool.effects.includes("git_write") ||
    tool.effects.includes("external_write")
  ) {
    if (grant.maximumWorkspaceEffect !== "write") {
      throw new GrantValidationError(
        "effect_not_granted",
        `Tool "${tool.name}" requires write workspace effect.`,
      );
    }
  }
}
