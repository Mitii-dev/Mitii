import type {
  ExecutionRoute,
  MutationBudget,
  ToolGrant,
} from "../../../modules/decision-policy";
import { EXECUTION_ROUTE } from "../../../modules/decision-policy";

import { AGENT_ENGINE_THRESHOLDS } from "../../../engine/v8-engine/legacy/policy";
import type { AgentReasonCode } from "../../../engine/v8-engine/contracts";

import { isClearMutationBlocker } from "./IsClearMutationBlocker";
import { shouldRecoverIncompleteAssistantTurn } from "./IsIncompleteAssistantTurn";
import { grantAllowsWorkspaceFileMutation } from "./WorkspaceMutationGrant";
import type {
  ResolveLoopTurnOutcome,
  ResolveLoopTurnOutcomeInput,
} from "./LoopTurnTypes";

export function isUnfulfilledExecute(input: {
  route: ExecutionRoute;
  maximumWorkspaceEffect: ToolGrant["maximumWorkspaceEffect"];
  primaryTaskIntent: string;
  toolCallCount: number;
  changedFileCount: number;
  content: string;
  reasonCodes?: readonly string[];
  allowedTools?: readonly string[];
}): boolean {
  if (input.toolCallCount > 0) {
    return false;
  }
  if (input.changedFileCount > 0) {
    return false;
  }
  if (
    !requiresMutationForExecute({
      route: input.route,
      maximumWorkspaceEffect: input.maximumWorkspaceEffect,
      primaryTaskIntent: input.primaryTaskIntent,
      reasonCodes: input.reasonCodes,
      allowedTools: input.allowedTools,
    })
  ) {
    return false;
  }
  // Recovery copy invites "stop with a clear blocker" when a workspace edit
  // cannot proceed (missing config, credentials, external dependency, etc.).
  if (isClearMutationBlocker(input.content)) {
    return false;
  }
  // Any other text-only stop on execute+write is unfulfilled: the model
  // described work instead of calling apply_patch.
  return true;
}

/**
 * Synthetic fallback from {@link synthesizeFallbackAnswer} when the model
 * stopped empty after some edits. Looks like success but often hides an
 * unfinished multi-phase checklist (BillBuddy 00:13 POM refactor).
 */
export function isSyntheticCompletedEditsFallback(content: string): boolean {
  return /^(?:Completed workspace edits|Workspace edits so far) \(\d+ files?\):/i.test(
    content.trim(),
  );
}

/**
 * Partial mutations landed, but the model stopped with empty/mid-work/synthetic
 * text while change checklist surfaces remain open. Must not mark the run
 * completed (architecture-scale execute often needs many batches).
 */
export function isPrematurePartialExecuteStop(params: {
  mutationRequired: boolean;
  hasIncompleteChangeSurfaces: boolean;
  content: string;
  changedFileCount: number;
}): boolean {
  if (!params.mutationRequired || !params.hasIncompleteChangeSurfaces) {
    return false;
  }
  if (params.changedFileCount <= 0) {
    return false;
  }
  const text = params.content.trim();
  if (text.length === 0) {
    return true;
  }
  if (isSyntheticCompletedEditsFallback(text)) {
    return true;
  }
  if (isClearMutationBlocker(text)) {
    return false;
  }
  return shouldRecoverIncompleteAssistantTurn({
    content: text,
    toolCallCount: 0,
    changedFileCount: params.changedFileCount,
  });
}

/** Model claimed it cannot see the repo despite repository_answer/diagnose. */
export function claimsMissingWorkspaceContext(content: string): boolean {
  const text = content.trim();
  if (text.length < 24) {
    return false;
  }
  return (
    /\b(?:don'?t|do not|cannot|can'?t)\s+have\b[\s\S]{0,60}\b(?:repository|workspace|files?|context)\b/i.test(
      text,
    ) ||
    /\bno\s+(?:repository|workspace)\s+(?:files?|context|code)\b/i.test(text) ||
    /\b(?:can'?t|cannot)\s+identify\b/i.test(text) ||
    /\bwithout\s+(?:access to|any)\s+(?:the\s+)?(?:repository|workspace|files?|code)\b/i.test(
      text,
    )
  );
}

export function needsWorkspaceGroundingRecovery(input: {
  route: ExecutionRoute;
  toolCallCount: number;
  fileReadCalls?: number;
  content: string;
}): boolean {
  if (input.toolCallCount > 0) {
    return false;
  }
  if ((input.fileReadCalls ?? 0) > 0) {
    return false;
  }
  if (
    input.route !== EXECUTION_ROUTE.REPOSITORY_ANSWER &&
    input.route !== EXECUTION_ROUTE.DIAGNOSE &&
    input.route !== EXECUTION_ROUTE.DIRECT_ANSWER
  ) {
    return false;
  }
  return claimsMissingWorkspaceContext(input.content);
}

/**
 * Execute + write grant requires a workspace file mutation when file-edit
 * tools are still on the grant. Intent taxonomy alone was too easy to
 * misclassify (e.g. feature ask labeled as question), which let zero-edit
 * runs exit 0 and fail benchmark workspace_changed checks.
 * Ask/plan/diagnose/read-only grants stay exempt via route / effect gates.
 * Database readwrite (retainWriteEffect, apply_patch denied) is exempt so
 * successful MCP inserts are not chased with apply_patch recoveries.
 */
export function requiresMutationForExecute(input: {
  route: ExecutionRoute;
  maximumWorkspaceEffect: ToolGrant["maximumWorkspaceEffect"];
  primaryTaskIntent?: string;
  reasonCodes?: readonly string[];
  allowedTools?: readonly string[];
}): boolean {
  if (input.route !== EXECUTION_ROUTE.EXECUTE) {
    return false;
  }
  if (input.maximumWorkspaceEffect !== "write") {
    return false;
  }
  // DCO / Signed-off-by tasks mutate git objects via git_signoff_range, not
  // workspace files — do not chase apply_patch or fail no_mutation_performed.
  if (input.reasonCodes?.includes("vcs_history_rewrite")) {
    return false;
  }
  if (!grantAllowsWorkspaceFileMutation(input.allowedTools)) {
    return false;
  }
  return true;
}

export function buildUnfulfilledExecuteRecoveryMessage(
  _mutationBudget?: MutationBudget,
): string {
  return [
    "You described the fix but did not call apply_patch.",
    "Do not repeat the diagnosis or write a report.",
    "Prefer calling apply_patch now for the next bounded batch using the live working-set mutation budget and compiler/preflight sections.",
    "If a write/mustRead path for the active checklist row is still missing from evidence, you may call read_file or read_many_files for those paths (a few turns) — then patch.",
    "Do not call list_directory, glob_files, search_files, or run_readonly_command for broad rediscovery on this recovery turn.",
    "If you still cannot make a bounded edit from evidence, stop with a clear blocker. Do not end this turn with analysis only.",
  ].join("\n");
}

export function recoverOrExhaustUnfulfilled(
  input: ResolveLoopTurnOutcomeInput,
  truncatedReason?: AgentReasonCode,
): ResolveLoopTurnOutcome {
  const maxUnfulfilled =
    input.thresholds?.maxUnfulfilledExecuteRecoveries ??
    AGENT_ENGINE_THRESHOLDS.maxUnfulfilledExecuteRecoveries;
  if (input.recoveries.unfulfilledExecute < maxUnfulfilled) {
    return {
      disposition: "recover_unfulfilled_execute",
      reasonCode: truncatedReason ?? "unfulfilled_execute_recovered",
      recoveryMessage: buildUnfulfilledExecuteRecoveryMessage(
        input.mutationBudget,
      ),
    };
  }
  return {
    disposition: "complete_answer",
    reasonCode: "unfulfilled_execute_exhausted",
    recoveryMessage: buildUnfulfilledExecuteRecoveryMessage(
      input.mutationBudget,
    ),
  };
}
