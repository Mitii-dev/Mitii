import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { MutationBudget } from "../../../modules/decision-policy";

import { AGENT_ENGINE_THRESHOLDS } from "../policy";
import type { AgentEngineThresholds } from "./resolveAgentEngineThresholds";
import {
  isMidWorkAnalysisDump,
  isTransitionalAssistantAnswer,
  isUnfinishedInvestigationAnswer,
} from "./isIncompleteAssistantTurn";

export interface TruncationRecoveryPlan {
  /** Whether the Engine should discard tool calls and continue with a nudge. */
  shouldRecover: boolean;
  /** Recovery shape so Agent Engine can preserve/append partial final text. */
  recoveryKind: "tool_call" | "text_continuation";
  /** Incomplete / unparseable tool calls that must not be executed. */
  incompleteToolCalls: ModelToolCall[];
  /** Assistant message content to keep (no broken toolCalls). */
  assistantContent: string;
  /** User nudge instructing a smaller batch. */
  recoveryMessage: ModelMessage;
}

/**
 * Decide whether a length-truncated model turn should recover instead of
 * executing incomplete tool calls or ending the run.
 */
export function buildOutputTruncationRecovery(params: {
  finishReason?: string;
  content: string;
  toolCalls: readonly ModelToolCall[];
  mutationBudget?: MutationBudget;
  recoveryAttempt: number;
  /**
   * When true, a truncated text-only turn on execute+write must recover as
   * a mutation batch, not as essay continuation.
   */
  requireMutation?: boolean;
  /**
   * Files already mutated this run. After the first successful write, another
   * multi-minute "short final answer" / essay recovery often burns the harness
   * wall clock (benchmark exit 124) even though content checks already pass.
   */
  changedFileCount?: number;
  /**
   * Live checklist evidence that concrete write surfaces are still open. This
   * overrides the post-mutation finish bias for package-scale batched work.
   */
  hasIncompleteChangeSurfaces?: boolean;
  /** Verification already passed after mutation — never open another recovery turn. */
  successfulVerificationAfterMutation?: boolean;
  thresholds?: Pick<
    AgentEngineThresholds,
    | "maxTruncationRecoveries"
    | "defaultPreferredBatchSize"
    | "defaultMaxPatchesPerCall"
  >;
}): TruncationRecoveryPlan | null {
  const thresholds = params.thresholds ?? AGENT_ENGINE_THRESHOLDS;
  const truncated = params.finishReason === "length";
  if (!truncated) {
    return null;
  }

  if (params.recoveryAttempt >= thresholds.maxTruncationRecoveries) {
    return null;
  }

  const mutationsLanded = (params.changedFileCount ?? 0) > 0;
  if (params.successfulVerificationAfterMutation === true && mutationsLanded) {
    return null;
  }
  const checklistWorkRemains = params.hasIncompleteChangeSurfaces === true;

  const incompleteToolCalls = params.toolCalls.filter(
    (call) => !isCompleteToolCall(call),
  );

  if (incompleteToolCalls.length === 0 && params.toolCalls.length > 0) {
    // Complete tool calls after a length stop are still executable.
    return null;
  }

  // After mutations: allow at most one shrink-retry for incomplete tools, then
  // finish — except when the live checklist still has concrete write surfaces
  // open, or for empty reasoning-only burns while mutation is still required
  // (reasoning-only thrash mid-checklist).
  if (mutationsLanded) {
    const emptyReasoningBurn =
      params.content.trim().length === 0 && incompleteToolCalls.length === 0;
    if (
      emptyReasoningBurn &&
      params.requireMutation === true &&
      params.successfulVerificationAfterMutation !== true &&
      (checklistWorkRemains || params.recoveryAttempt < 1)
    ) {
      const preferred = escalatePreferredBatchSize(
        params.mutationBudget?.preferredBatchSize ??
          thresholds.defaultPreferredBatchSize,
        params.recoveryAttempt,
      );
      const maxPatches = escalateMaxPatches(
        params.mutationBudget?.maxPatchesPerCall ??
          thresholds.defaultMaxPatchesPerCall,
        params.recoveryAttempt,
      );
      return {
        shouldRecover: true,
        recoveryKind: "tool_call",
        incompleteToolCalls: [],
        assistantContent: "",
        recoveryMessage: {
          role: "user",
          content: [
            "Your previous turn hit the output token limit while writing internal reasoning only (no tools, no user-facing answer).",
            "Do not continue that essay.",
            `Checklist work remains. Call apply_patch now with a smaller batch: at most ${preferred} files (hard max ${maxPatches} patches).`,
            "If you need one short read first, call read_file or document_symbol on the active write path only, then patch.",
          ].join("\n"),
        },
      };
    }
    if (incompleteToolCalls.length === 0 && !checklistWorkRemains) {
      return null;
    }
    if (!checklistWorkRemains && params.recoveryAttempt >= 1) {
      return null;
    }
  }

  if (incompleteToolCalls.length === 0) {
    const text = params.content.trim();

    // BillBuddy 00:48 / 23:45: length-stop with empty content is a reasoning-
    // channel burn (consumeModelTurn refuses to promote reasoning on length).
    // Recover immediately — do not fall through as a silent empty no-tool turn.
    const emptyReasoningBurn = text.length === 0;

    // BillBuddy 23:45: length-stop after a reasoning burn (content channel
    // empty → consumeModelTurn falls back to reasoning) must not seed
    // pendingTextContinuation with a mid-work essay that later hides the
    // real answer via selectUserFacingLoopAnswer.
    const reasoningBurn =
      emptyReasoningBurn ||
      isMidWorkAnalysisDump(text) ||
      isUnfinishedInvestigationAnswer(text) ||
      isTransitionalAssistantAnswer(text);

    if (emptyReasoningBurn || params.requireMutation || reasoningBurn) {
      const preferred = escalatePreferredBatchSize(
        params.mutationBudget?.preferredBatchSize ??
          thresholds.defaultPreferredBatchSize,
        params.recoveryAttempt,
      );
      const maxPatches = escalateMaxPatches(
        params.mutationBudget?.maxPatchesPerCall ??
          thresholds.defaultMaxPatchesPerCall,
        params.recoveryAttempt,
      );
      const forcePatch = params.requireMutation === true;
      return {
        shouldRecover: true,
        recoveryKind: "tool_call",
        incompleteToolCalls: [],
        // Drop the burned essay so it cannot poison the final answer.
        assistantContent: "",
        recoveryMessage: {
          role: "user",
          content: reasoningBurn
            ? [
                emptyReasoningBurn
                  ? "Your previous turn hit the output token limit while writing internal reasoning only (no tools, no user-facing answer)."
                  : "Your previous turn hit the output token limit while writing internal analysis/reasoning, not a user-facing answer.",
                "Do not continue that essay.",
                forcePatch
                  ? `Call apply_patch now with a smaller batch: at most ${preferred} files (hard max ${maxPatches} patches).`
                  : "Give a short final answer to the user now (or call one essential tool). Do not restate your plan.",
              ].join("\n")
            : [
                "Your previous response was truncated because the output token limit was reached.",
                "Do not continue the written analysis.",
                params.recoveryAttempt === 0
                  ? `Call apply_patch now with a smaller batch: at most ${preferred} files (hard max ${maxPatches} patches).`
                  : params.recoveryAttempt === 1
                    ? `Previous retry was still truncated. Shrink further: at most ${preferred} file(s) and ${maxPatches} patch(es).`
                    : `Last recovery. One file, one minimal hunk (hard max ${maxPatches} patch).`,
                "Leave remaining files for later turns.",
              ].join("\n"),
        },
      };
    }

    if (text.length === 0) {
      return null;
    }

    return {
      shouldRecover: true,
      recoveryKind: "text_continuation",
      incompleteToolCalls: [],
      assistantContent: params.content,
      recoveryMessage: {
        role: "user",
        content: buildTextContinuationNudge(params.recoveryAttempt),
      },
    };
  }

  const preferred = escalatePreferredBatchSize(
    params.mutationBudget?.preferredBatchSize ??
      thresholds.defaultPreferredBatchSize,
    params.recoveryAttempt,
  );
  const maxPatches = escalateMaxPatches(
    params.mutationBudget?.maxPatchesPerCall ??
      thresholds.defaultMaxPatchesPerCall,
    params.recoveryAttempt,
  );

  const recoveryMessage: ModelMessage = {
    role: "user",
    content: [
      "Your previous response was truncated because the output token limit was reached.",
      "Do not repeat the oversized tool call.",
      params.recoveryAttempt === 0
        ? `Continue the task with a smaller batch: at most ${preferred} files (hard max ${maxPatches} patches) per apply_patch.`
        : params.recoveryAttempt === 1
          ? `Previous retry was still truncated. Shrink further: at most ${preferred} file(s) and ${maxPatches} patch(es).`
          : `Last recovery. One file, one minimal hunk (hard max ${maxPatches} patch). Finish this slice only.`,
      "Prefer minimal oldText/newText hunks — never rewrite whole files unless required.",
      "If many files remain, apply the next batch now and leave the rest for later turns.",
    ].join("\n"),
  };

  return {
    shouldRecover: true,
    recoveryKind: "tool_call",
    incompleteToolCalls: [...incompleteToolCalls],
    assistantContent:
      params.content.trim().length > 0
        ? `${params.content}\n\n…(output truncated — retrying with a smaller batch)`
        : "(previous model output truncated — retrying with a smaller batch)",
    recoveryMessage,
  };
}

function escalatePreferredBatchSize(
  preferred: number,
  recoveryAttempt: number,
): number {
  if (recoveryAttempt <= 0) {
    return Math.max(1, preferred);
  }
  if (recoveryAttempt === 1) {
    return Math.max(1, Math.floor(preferred / 2));
  }
  return 1;
}

function escalateMaxPatches(maxPatches: number, recoveryAttempt: number): number {
  if (recoveryAttempt <= 0) {
    return Math.max(1, maxPatches);
  }
  if (recoveryAttempt === 1) {
    return Math.max(1, Math.floor(maxPatches / 2));
  }
  return 1;
}

function buildTextContinuationNudge(recoveryAttempt: number): string {
  if (recoveryAttempt <= 0) {
    return [
      "Your previous answer was truncated because the output token limit was reached.",
      "Continue exactly where it stopped.",
      "Do not restart from the beginning or repeat completed sections.",
      "Keep the continuation concise and finish the answer.",
    ].join("\n");
  }
  if (recoveryAttempt === 1) {
    return [
      "The continuation was truncated again.",
      "Finish in 2–3 sentences from the exact cutoff. Do not repeat earlier text.",
    ].join("\n");
  }
  return [
    "Last recovery after repeated truncation.",
    "Give only the remaining conclusion. No recap, no tools, no preamble.",
  ].join("\n");
}

export function isCompleteToolCall(call: ModelToolCall): boolean {
  if (!call.name || call.name.length === 0) {
    return false;
  }
  const raw = call.arguments?.trim() ?? "";
  if (raw.length === 0) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (call.name === "apply_patch") {
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("patches" in parsed) ||
        !Array.isArray((parsed as { patches: unknown }).patches) ||
        (parsed as { patches: unknown[] }).patches.length === 0
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
