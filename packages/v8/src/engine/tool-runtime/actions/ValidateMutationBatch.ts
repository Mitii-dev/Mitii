import type { MutationBudget, ToolGrant } from "../../../modules/decision-policy";

import {
  DEFAULT_FALLBACK_MUTATION_BUDGET,
  MAX_APPLY_PATCH_PATCHES,
} from "../defaults";
import type { ToolReasonCode } from "../contracts";
import { normalizeApplyPatchArguments } from "../internal/normalizeApplyPatchArguments";

export class MutationBatchValidationError extends Error {
  public readonly reasonCode: ToolReasonCode;

  constructor(reasonCode: ToolReasonCode, message: string) {
    super(message);
    this.name = "MutationBatchValidationError";
    this.reasonCode = reasonCode;
  }
}

/**
 * Enforce Decision Policy mutationBudget (or runtime fallback) on apply_patch.
 * Rejects oversized batches before mutation transactions begin.
 */
export function validateMutationBatch(params: {
  toolName: string;
  arguments: unknown;
  grant: ToolGrant;
}): void {
  if (params.toolName !== "apply_patch") {
    return;
  }

  const patches = extractPatches(params.arguments);
  if (patches === null) {
    throw new MutationBatchValidationError(
      "invalid_arguments",
      "apply_patch requires a patches array.",
    );
  }

  const budget = resolveBudget(params.grant);
  const hardPatchCap = Math.min(
    budget.maxPatchesPerCall,
    MAX_APPLY_PATCH_PATCHES,
  );

  if (patches.length > hardPatchCap) {
    throw new MutationBatchValidationError(
      "mutation_budget_exceeded",
      `apply_patch allows at most ${hardPatchCap} patches per call (got ${patches.length}). Split into smaller batches.`,
    );
  }

  const uniqueFiles = new Set(
    patches
      .map((patch) => patch.path)
      .filter((path): path is string => typeof path === "string" && path.length > 0),
  );
  if (uniqueFiles.size > budget.maxUniqueFilesPerCall) {
    throw new MutationBatchValidationError(
      "mutation_budget_exceeded",
      `apply_patch allows at most ${budget.maxUniqueFilesPerCall} unique files per call (got ${uniqueFiles.size}). Split into smaller batches.`,
    );
  }

  let payloadCharacters = 0;
  for (const patch of patches) {
    payloadCharacters +=
      (typeof patch.oldText === "string" ? patch.oldText.length : 0) +
      (typeof patch.newText === "string" ? patch.newText.length : 0);
  }
  if (payloadCharacters > budget.maxPatchPayloadCharacters) {
    throw new MutationBatchValidationError(
      "mutation_budget_exceeded",
      `apply_patch payload is ${payloadCharacters} characters; max is ${budget.maxPatchPayloadCharacters}. Use smaller diffs or fewer files per call.`,
    );
  }
}

function resolveBudget(grant: ToolGrant): MutationBudget {
  if (grant.mutationBudget) {
    return grant.mutationBudget;
  }
  return { ...DEFAULT_FALLBACK_MUTATION_BUDGET };
}

function extractPatches(
  argumentsValue: unknown,
): Array<{ path?: unknown; oldText?: unknown; newText?: unknown }> | null {
  const normalized = normalizeApplyPatchArguments(argumentsValue);
  if (
    !normalized ||
    typeof normalized !== "object" ||
    !("patches" in normalized) ||
    !Array.isArray((normalized as { patches: unknown }).patches)
  ) {
    return null;
  }
  return (normalized as {
    patches: Array<{ path?: unknown; oldText?: unknown; newText?: unknown }>;
  }).patches;
}
