import type { MutationBudget, ToolGrant } from "../contracts";
import {
  deriveDiscoveredScopes,
  narrowPathScopes,
  preserveWorkspaceRootMutationScope,
  uniqueStrings,
} from "./pathScopes";

export function narrowToolGrant(params: {
  previous: ToolGrant;
  discoveredPaths: readonly string[];
  residualRisk?: "low" | "medium" | "high" | "critical";
  keepWriteWide?: boolean;
}): ToolGrant {
  const previous = params.previous;
  const highRisk =
    params.residualRisk === "high" || params.residualRisk === "critical";
  const keepWorkspaceRead = previous.pathScopes.includes(".");
  const narrowedReadScopes = keepWorkspaceRead
    ? [...previous.pathScopes]
    : narrowPathScopes(previous.pathScopes, params.discoveredPaths);

  let mutationPathScopes = previous.mutationPathScopes;
  if (previous.maximumWorkspaceEffect === "write" && !params.keepWriteWide) {
    if (previous.mutationPathScopes && previous.mutationPathScopes.length > 0) {
      mutationPathScopes = preserveWorkspaceRootMutationScope(
        previous.mutationPathScopes,
        narrowPathScopes(
          previous.mutationPathScopes,
          params.discoveredPaths,
        ),
      );
    } else if (params.discoveredPaths.length > 0) {
      const discoveredWrite = narrowPathScopes(["."], params.discoveredPaths);
      mutationPathScopes =
        discoveredWrite.length > 0 ? discoveredWrite : previous.mutationPathScopes;
    }
  }

  return {
    ...previous,
    pathScopes: narrowedReadScopes,
    mutationPathScopes,
    // Host "never" (Full access / guided auto-approve) must survive residual
    // risk elevation; otherwise apply_patch keeps demanding approval.
    approvalMode:
      previous.approvalMode === "never"
        ? "never"
        : highRisk
          ? "every_mutation"
          : previous.approvalMode,
    mutationBudget:
      highRisk && previous.mutationBudget
        ? tightenMutationBudget(previous.mutationBudget)
        : previous.mutationBudget,
  };
}

export function widenToolGrant(params: {
  previous: ToolGrant;
  extraPaths: readonly string[];
  extraAllowedRoots?: readonly string[];
  extraNetworkHosts?: readonly string[];
}): ToolGrant {
  const extraScopes = deriveDiscoveredScopes(params.extraPaths);
  const previousHosts = params.previous.networkHosts ?? [];
  const mergedHosts = uniqueStrings([
    ...previousHosts,
    ...(params.extraNetworkHosts ?? []),
  ]).slice(0, 16);
  const previousRoots = params.previous.extraAllowedRoots ?? [];
  const mergedRoots = uniqueStrings([
    ...previousRoots,
    ...(params.extraAllowedRoots ?? []),
  ]).slice(0, 20);

  const hostsChanged =
    mergedHosts.length !== previousHosts.length ||
    mergedHosts.some((host, index) => host !== previousHosts[index]);
  const rootsChanged =
    mergedRoots.length !== previousRoots.length ||
    mergedRoots.some((root, index) => root !== previousRoots[index]);

  if (extraScopes.length === 0 && !hostsChanged && !rootsChanged) {
    return params.previous;
  }

  const pathScopes =
    extraScopes.length === 0
      ? [...params.previous.pathScopes]
      : params.previous.pathScopes.includes(".")
        ? [...params.previous.pathScopes]
        : uniqueStrings([...params.previous.pathScopes, ...extraScopes]);

  const mutationPathScopes =
    extraScopes.length > 0 &&
    params.previous.maximumWorkspaceEffect === "write"
      ? uniqueStrings([
          ...(params.previous.mutationPathScopes ?? []),
          ...extraScopes,
        ])
      : params.previous.mutationPathScopes;

  return {
    ...params.previous,
    pathScopes,
    mutationPathScopes:
      mutationPathScopes && mutationPathScopes.length > 0
        ? mutationPathScopes
        : params.previous.mutationPathScopes,
    networkHosts: hostsChanged ? mergedHosts : params.previous.networkHosts,
    extraAllowedRoots: rootsChanged
      ? mergedRoots
      : params.previous.extraAllowedRoots,
  };
}

function tightenMutationBudget(budget: MutationBudget): MutationBudget {
  return {
    maxPatchesPerCall: Math.max(1, Math.min(budget.maxPatchesPerCall, 3)),
    maxUniqueFilesPerCall: Math.max(
      1,
      Math.min(budget.maxUniqueFilesPerCall, 2),
    ),
    maxPatchPayloadCharacters: Math.max(
      1,
      Math.min(budget.maxPatchPayloadCharacters, 18_000),
    ),
    preferredBatchSize: Math.max(1, Math.min(budget.preferredBatchSize, 1)),
    requireBatchedExecution: true,
  };
}
