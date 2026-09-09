import type { ApprovalMode, ToolGrant } from "../contracts";
import type { UserSafetyRules } from "../contracts/input/UserSafetyRules";

const APPROVAL_STRICTNESS: Record<ApprovalMode, number> = {
  every_mutation: 2,
  when_required: 1,
  never: 0,
};

export interface IntersectUserSafetyResult {
  toolGrant: ToolGrant;
  /** True when the grant changed after intersect. */
  tightened: boolean;
  /** Only Decision Policy enum codes — use grant_narrowed when tightened. */
  reasonCodes: Array<"grant_narrowed">;
}

/**
 * Intersect user safety rules onto a policy grant.
 * Never widens: only removes authority or raises approval strictness.
 */
export function intersectUserSafetyRules(
  grant: ToolGrant,
  rules: UserSafetyRules | undefined,
): IntersectUserSafetyResult {
  if (!rules || rules.enabled !== true) {
    return { toolGrant: grant, tightened: false, reasonCodes: [] };
  }

  let next: ToolGrant = { ...grant };

  if (rules.denyTools.length > 0) {
    const deny = new Set(rules.denyTools);
    const filtered = next.allowedTools.filter((tool) => !deny.has(tool));
    if (filtered.length !== next.allowedTools.length) {
      next = { ...next, allowedTools: filtered };
    }
  }

  if (rules.denyPathScopes.length > 0) {
    const deny = new Set(rules.denyPathScopes);
    const pathScopes = next.pathScopes.filter((scope) => !deny.has(scope));
    const mutationPathScopes = next.mutationPathScopes
      ? next.mutationPathScopes.filter((scope) => !deny.has(scope))
      : undefined;
    if (
      pathScopes.length !== next.pathScopes.length ||
      (mutationPathScopes &&
        mutationPathScopes.length !== (next.mutationPathScopes?.length ?? 0))
    ) {
      next = {
        ...next,
        pathScopes: pathScopes.length > 0 ? pathScopes : ["."],
        mutationPathScopes:
          mutationPathScopes && mutationPathScopes.length > 0
            ? mutationPathScopes
            : undefined,
      };
    }
  }

  if (rules.denyNetworkHosts.length > 0 && next.networkHosts) {
    const deny = new Set(rules.denyNetworkHosts);
    const networkHosts = next.networkHosts.filter((host) => !deny.has(host));
    if (networkHosts.length !== next.networkHosts.length) {
      next = { ...next, networkHosts };
    }
  }

  if (next.commandRules && next.commandRules.length > 0) {
    const denyPrefixes = new Set(
      rules.denyCommandPrefixes.map((p) => p.toLowerCase()),
    );
    const allowOnly =
      rules.allowCommandPrefixes && rules.allowCommandPrefixes.length > 0
        ? new Set(rules.allowCommandPrefixes.map((p) => p.toLowerCase()))
        : null;

    const commandRules = next.commandRules
      .map((rule) => {
        let prefixes = rule.prefixes.filter(
          (prefix) => !denyPrefixes.has(prefix.toLowerCase()),
        );
        if (allowOnly) {
          prefixes = prefixes.filter((prefix) =>
            allowOnly.has(prefix.toLowerCase()),
          );
        }
        return { ...rule, prefixes };
      })
      .filter((rule) => rule.prefixes.length > 0);

    if (JSON.stringify(commandRules) !== JSON.stringify(next.commandRules)) {
      next = {
        ...next,
        commandRules: commandRules.length > 0 ? commandRules : undefined,
      };
    }
  }

  if (rules.approvalCeiling) {
    const current = APPROVAL_STRICTNESS[next.approvalMode];
    const ceiling = APPROVAL_STRICTNESS[rules.approvalCeiling];
    if (ceiling > current) {
      next = { ...next, approvalMode: rules.approvalCeiling };
    }
  }

  // Drop write effects that no longer have matching tools.
  if (next.maximumWorkspaceEffect === "write") {
    const hasMutationTool = next.allowedTools.some((tool) =>
      ["apply_patch", "delete_file", "delete_directory", "move_file"].includes(
        tool,
      ),
    );
    if (!hasMutationTool) {
      next = {
        ...next,
        maximumWorkspaceEffect: "read",
        mutationBudget: undefined,
        mutationPathScopes: undefined,
      };
    }
  }

  const tightened =
    JSON.stringify(normalizeForCompare(grant)) !==
    JSON.stringify(normalizeForCompare(next));

  return {
    toolGrant: next,
    tightened,
    reasonCodes: tightened ? ["grant_narrowed"] : [],
  };
}

function normalizeForCompare(grant: ToolGrant): unknown {
  return {
    ...grant,
    allowedTools: [...grant.allowedTools].sort(),
    allowedEffects: [...grant.allowedEffects].sort(),
    pathScopes: [...grant.pathScopes].sort(),
    mutationPathScopes: grant.mutationPathScopes
      ? [...grant.mutationPathScopes].sort()
      : undefined,
    networkHosts: grant.networkHosts
      ? [...grant.networkHosts].sort()
      : undefined,
  };
}

/**
 * Assert that `after` is a subset of `before` (never wider).
 * Used by tests and optional host diagnostics.
 */
export function grantNeverWidens(before: ToolGrant, after: ToolGrant): boolean {
  const beforeTools = new Set(before.allowedTools);
  if (after.allowedTools.some((tool) => !beforeTools.has(tool))) {
    return false;
  }
  const beforeEffects = new Set(before.allowedEffects);
  if (after.allowedEffects.some((effect) => !beforeEffects.has(effect))) {
    return false;
  }
  if (
    APPROVAL_STRICTNESS[after.approvalMode] <
    APPROVAL_STRICTNESS[before.approvalMode]
  ) {
    return false;
  }
  const beforePrefixes = new Set(
    (before.commandRules ?? []).flatMap((rule) =>
      rule.prefixes.map((p) => p.toLowerCase()),
    ),
  );
  for (const rule of after.commandRules ?? []) {
    for (const prefix of rule.prefixes) {
      if (
        beforePrefixes.size > 0 &&
        !beforePrefixes.has(prefix.toLowerCase())
      ) {
        return false;
      }
    }
  }
  return true;
}
