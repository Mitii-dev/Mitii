import type { ToolGrant } from "../contracts";

/**
 * Human-readable effective grant summary for CLI / VS Code readout.
 * Host-neutral — no UI framework imports.
 */
export function formatEffectiveGrant(grant: ToolGrant): string {
  const lines: string[] = [
    `Effect: ${grant.maximumWorkspaceEffect}`,
    `Approval: ${grant.approvalMode}`,
    `Tools (${grant.allowedTools.length}): ${summarizeList(grant.allowedTools, 12)}`,
    `Path scopes: ${grant.pathScopes.join(", ") || "(none)"}`,
  ];

  if (grant.mutationPathScopes?.length) {
    lines.push(`Mutation scopes: ${grant.mutationPathScopes.join(", ")}`);
  }

  const prefixes = (grant.commandRules ?? []).flatMap((rule) => rule.prefixes);
  if (prefixes.length > 0) {
    lines.push(`Command prefixes: ${summarizeList(prefixes, 16)}`);
  } else {
    lines.push("Command prefixes: (none)");
  }

  if (grant.networkHosts?.length) {
    lines.push(`Network hosts: ${summarizeList(grant.networkHosts, 8)}`);
  }

  lines.push(
    `Limits: tools=${grant.limits.maxToolCalls} wallMs=${grant.limits.maxWallTimeMs} outBytes=${grant.limits.maxOutputBytes}`,
  );

  if (grant.mutationBudget) {
    lines.push(
      `Mutation budget: files≤${grant.mutationBudget.maxUniqueFilesPerCall} patches≤${grant.mutationBudget.maxPatchesPerCall}`,
    );
  }

  return lines.join("\n");
}

export function formatEffectiveGrantJson(grant: ToolGrant): string {
  return JSON.stringify(
    {
      maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
      approvalMode: grant.approvalMode,
      allowedTools: [...grant.allowedTools].sort(),
      allowedEffects: [...grant.allowedEffects].sort(),
      pathScopes: grant.pathScopes,
      mutationPathScopes: grant.mutationPathScopes,
      commandPrefixes: (grant.commandRules ?? []).flatMap((r) => r.prefixes),
      networkHosts: grant.networkHosts ?? [],
      limits: grant.limits,
      mutationBudget: grant.mutationBudget,
    },
    null,
    2,
  );
}

function summarizeList(items: readonly string[], max: number): string {
  if (items.length === 0) return "(none)";
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} (+${items.length - max} more)`;
}
