import {
  claimsPackageScriptsWithoutEvidence,
  isDegenerateRepeatedAnswer,
  isEmptyAssistantTurn,
  isMidWorkAnalysisDump,
  isPseudoToolRequestAnswer,
  isTransitionalAssistantAnswer,
  isUnfinishedInvestigationAnswer,
  looksLikeInstructionalAnswer,
} from "./AssistantTurnDetectors";
import { compactRecoveredAssistantContent } from "./RecoveredAssistantContent";

export function shouldRecoverIncompleteAssistantTurn(params: {
  content: string;
  toolCallCount: number;
  changedFileCount: number;
  fileReadCalls?: number;
}): boolean {
  if (params.toolCallCount > 0) return false;
  if (isEmptyAssistantTurn(params)) return true;
  if (isPseudoToolRequestAnswer(params.content)) return true;
  if (isDegenerateRepeatedAnswer(params.content)) return true;
  if (isUnfinishedInvestigationAnswer(params.content)) return true;
  if (isMidWorkAnalysisDump(params.content)) return true;
  if (
    (params.fileReadCalls ?? 0) === 0 &&
    claimsPackageScriptsWithoutEvidence(params.content) &&
    !looksLikeInstructionalAnswer(params.content)
  ) {
    return true;
  }
  // Defense in depth: blank stored answer after mutations must not complete.
  if (params.content.trim().length === 0 && params.changedFileCount > 0) {
    return true;
  }
  if (
    isTransitionalAssistantAnswer(params.content) &&
    (params.changedFileCount > 0 || params.content.trim().length < 180)
  ) {
    return true;
  }
  return false;
}

export function buildIncompleteAnswerRecoveryMessage(params: {
  changedFiles: readonly string[];
  emptyTurn: boolean;
}): string {
  const changed =
    params.changedFiles.length > 0
      ? `\nChanged files so far: ${params.changedFiles.slice(0, 40).join(", ")}${
          params.changedFiles.length > 40 ? ", …" : ""
        }`
      : "";

  if (params.emptyTurn) {
    return [
      "Your previous model turn returned no content and no tool calls.",
      "Continue the task. If work is done, give a concise final answer to the user covering what changed and what remains.",
      "Do not end with only a narration like \"Let me check…\".",
      changed,
    ]
      .filter((part) => part.length > 0)
      .join("\n");
  }

  return [
    "Your previous reply looked like mid-task narration or an incomplete tool attempt, not a final answer.",
    "Continue: call needed tools (including apply_patch when a fix is required), or finish with a clear user-facing summary of the outcome.",
    "Do not end on transitional phrases like \"Let me…\", \"Actually…\", or leaked tool markup.",
    changed,
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

const EMPTY_RUN_FALLBACK =
  "I stopped without a complete final answer. Please ask a follow-up if you want me to continue.";

function priorIsUsableFinalAnswer(prior: string): boolean {
  if (prior.length === 0) return false;
  if (isTransitionalAssistantAnswer(prior)) return false;
  if (isUnfinishedInvestigationAnswer(prior)) return false;
  if (isMidWorkAnalysisDump(prior)) return false;
  if (isDegenerateRepeatedAnswer(prior)) return false;
  return true;
}

export function synthesizeFallbackAnswer(params: {
  priorAnswer?: string;
  changedFiles: readonly string[];
}): string {
  const prior = params.priorAnswer?.trim() ?? "";
  const paths = params.changedFiles;
  if (paths.length > 0) {
    const list = paths.slice(0, 40).join(", ") + (paths.length > 40 ? ", …" : "");
    if (priorIsUsableFinalAnswer(prior)) {
      return `${prior}\n\nChanged files (${paths.length}): ${list}`;
    }
    // Avoid implying the job is done — verification / checklist may still be open.
    return `Workspace edits so far (${paths.length} file${
      paths.length === 1 ? "" : "s"
    }): ${list}`;
  }
  if (priorIsUsableFinalAnswer(prior)) {
    return prior;
  }
  if (prior.length > 0) {
    const compacted = compactRecoveredAssistantContent(prior);
    const usable = compacted.trim();
    if (
      usable.length >= 40 &&
      !isTransitionalAssistantAnswer(usable) &&
      !isUnfinishedInvestigationAnswer(usable)
    ) {
      return usable;
    }
  }
  return EMPTY_RUN_FALLBACK;
}

/**
 * Prefer a verification summary (or a short changed-files fallback) over a
 * truncated planning dump when the run ends.
 */
