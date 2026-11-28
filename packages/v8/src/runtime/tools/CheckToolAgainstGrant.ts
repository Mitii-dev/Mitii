import type { GrantDenyReason } from "./GrantDenyReasons";

/** Minimal grant shape for deny checks (full ToolGrant later). */
export interface GrantSurface {
  allowedTools?: string[];
  allowedEffects?: string[];
  maximumWorkspaceEffect?: "none" | "read" | "write";
  /** Mirrors decision-policy ApprovalMode — drives mid-turn mutate suspend. */
  approvalMode?: "never" | "when_required" | "every_mutation";
  /** Optional path scopes; lifted into ToolGrant.pathScopes when present. */
  pathScopes?: string[];
  readPaths?: string[];
  writePaths?: string[];
  /**
   * Argv-only process prefixes for run_readonly_command / run_command.
   * Must survive GrantSurface → ToolGrant or every shell call is
   * command_not_allowed.
   */
  commandRules?: ReadonlyArray<{
    prefixes: readonly string[];
    allowShellMetacharacters?: boolean;
    maxOutputBytes?: number;
  }>;
}

export interface ToolGrantCheckResult {
  ok: boolean;
  reason?: GrantDenyReason;
}

/**
 * Policy-stateless grant check — prompt ⊆ grant ⊆ registry starts here.
 */
/** Session checklist tools — always allowed when exposed in the prompt. */
const GRANT_EXEMPT_META_TOOLS = new Set(["update_todos", "describe_tool"]);

export function checkToolAgainstGrant(params: {
  toolId: string;
  effect?: "none" | "read" | "mutate" | "external";
  grant: GrantSurface;
}): ToolGrantCheckResult {
  if (GRANT_EXEMPT_META_TOOLS.has(params.toolId)) {
    return { ok: true };
  }
  const allowed = params.grant.allowedTools ?? [];
  if (allowed.length > 0 && !allowed.includes(params.toolId)) {
    return { ok: false, reason: "tool_not_allowed" };
  }

  if (params.effect === "mutate") {
    if (params.grant.maximumWorkspaceEffect !== "write") {
      return { ok: false, reason: "effect_not_granted" };
    }
    const effects = params.grant.allowedEffects ?? [];
    if (
      effects.length > 0 &&
      !effects.includes("workspace_write") &&
      !effects.includes("mutate")
    ) {
      return { ok: false, reason: "effect_not_granted" };
    }
  }

  if (
    params.effect === "external" &&
    (params.grant.allowedEffects?.length ?? 0) > 0 &&
    !params.grant.allowedEffects!.includes("network") &&
    !params.grant.allowedEffects!.includes("external")
  ) {
    return { ok: false, reason: "network_not_allowed" };
  }

  return { ok: true };
}
