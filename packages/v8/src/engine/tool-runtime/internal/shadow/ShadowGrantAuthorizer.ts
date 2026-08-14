import type { ToolGrant } from "../../../../modules/decision-policy";

import type { ToolDefinition } from "../ToolCatalog";

export type ShadowAuthorizeDecision = "Allow" | "Deny";

export interface ShadowAuthorizeResult {
  decision: ShadowAuthorizeDecision;
  reason: string;
  /** Human-readable Cedar-like policy snapshot for audit / future cedar-wasm. */
  cedarPolicy?: string;
}

export interface ShadowGrantAuthorizer {
  /**
   * Independently evaluate whether a tool call should be allowed under the
   * current grant. Shadow mode logs disagreements; it does not override the
   * primary ValidateGrant enforcer unless enforce=true.
   */
  authorize(params: {
    tool: ToolDefinition;
    grant: ToolGrant;
    arguments?: unknown;
  }): ShadowAuthorizeResult;
}

const MCP_TOOL_NAME_PREFIX = "mcp__";

/**
 * Structural forbid-wins authorizer mirroring ToolGrant checks.
 * Emits Cedar-shaped policy text so hosts can later evaluate with
 * `@cedar-policy/cedar-wasm` without changing the grant model.
 */
export class StructuralShadowGrantAuthorizer implements ShadowGrantAuthorizer {
  public authorize(params: {
    tool: ToolDefinition;
    grant: ToolGrant;
    arguments?: unknown;
  }): ShadowAuthorizeResult {
    const { tool, grant } = params;
    const cedarPolicy = compileToolGrantToCedar(grant);

    const mcpAllowed =
      tool.name.startsWith(MCP_TOOL_NAME_PREFIX) &&
      grant.allowedTools.length > 0 &&
      grant.maximumWorkspaceEffect === "write";

    if (!grant.allowedTools.includes(tool.name) && !mcpAllowed) {
      return {
        decision: "Deny",
        reason: `tool_not_allowed:${tool.name}`,
        cedarPolicy,
      };
    }

    for (const effect of tool.effects) {
      if (!grant.allowedEffects.includes(effect)) {
        return {
          decision: "Deny",
          reason: `effect_not_granted:${effect}`,
          cedarPolicy,
        };
      }
    }

    if (
      tool.effects.includes("network_access") &&
      tool.name !== "web_search" &&
      (!grant.networkHosts || grant.networkHosts.length === 0)
    ) {
      return {
        decision: "Deny",
        reason: "network_not_allowed",
        cedarPolicy,
      };
    }

    if (
      (tool.effects.includes("workspace_write") ||
        tool.effects.includes("git_write") ||
        tool.effects.includes("external_write")) &&
      grant.maximumWorkspaceEffect !== "write"
    ) {
      return {
        decision: "Deny",
        reason: "write_effect_denied",
        cedarPolicy,
      };
    }

    const pathViolation = checkPathScope(grant, params.arguments);
    if (pathViolation) {
      return {
        decision: "Deny",
        reason: pathViolation,
        cedarPolicy,
      };
    }

    return {
      decision: "Allow",
      reason: "grant_permits",
      cedarPolicy,
    };
  }
}

export function compileToolGrantToCedar(grant: ToolGrant): string {
  const tools = grant.allowedTools.map((tool) => `"${tool}"`).join(", ");
  const effects = grant.allowedEffects.map((effect) => `"${effect}"`).join(", ");
  const scopes = grant.pathScopes.map((scope) => `"${scope}"`).join(", ");
  const hosts = (grant.networkHosts ?? [])
    .map((host) => `"${host}"`)
    .join(", ");

  return [
    "// Auto-compiled from ToolGrant for audit / cedar-wasm evaluation",
    "forbid (principal, action, resource);",
    `permit (principal, action, resource)`,
    `when {`,
    `  action in [${tools || `""`}] &&`,
    `  context.effect in [${effects || `""`}] &&`,
    `  context.maximumWorkspaceEffect == "${grant.maximumWorkspaceEffect}" &&`,
    `  context.pathScope in [${scopes || `"("`}]`,
    hosts.length > 0 ? `  && context.host in [${hosts}]` : "",
    `};`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function checkPathScope(
  grant: ToolGrant,
  argumentsValue: unknown,
): string | undefined {
  const paths = extractPaths(argumentsValue);
  if (paths.length === 0) {
    return undefined;
  }
  const scopes = grant.pathScopes;
  if (scopes.includes(".")) {
    return undefined;
  }
  for (const path of paths) {
    const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
    const allowed = scopes.some((scope) => {
      const normalizedScope = scope.replace(/\\/g, "/").replace(/\/+$/, "");
      return (
        normalized === normalizedScope ||
        normalized.startsWith(`${normalizedScope}/`)
      );
    });
    if (!allowed) {
      return `path_out_of_scope:${normalized}`;
    }
  }
  return undefined;
}

function extractPaths(argumentsValue: unknown): string[] {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return [];
  }
  const args = argumentsValue as Record<string, unknown>;
  const paths: string[] = [];
  if (typeof args.path === "string") {
    paths.push(args.path);
  }
  if (typeof args.from === "string") {
    paths.push(args.from);
  }
  if (typeof args.to === "string") {
    paths.push(args.to);
  }
  if (Array.isArray(args.patches)) {
    for (const patch of args.patches) {
      if (
        patch &&
        typeof patch === "object" &&
        typeof (patch as { path?: unknown }).path === "string"
      ) {
        paths.push((patch as { path: string }).path);
      }
    }
  }
  return paths;
}
