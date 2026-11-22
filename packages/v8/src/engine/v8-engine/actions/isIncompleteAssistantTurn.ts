import {
  claimsPackageScriptsWithoutEvidence,
  isDegenerateRepeatedAnswer,
  isEmptyAssistantTurn,
  isMidWorkAnalysisDump,
  isPseudoToolRequestAnswer,
  isTransitionalAssistantAnswer,
  isUnfinishedInvestigationAnswer,
  looksLikeInstructionalAnswer,
} from "./assistantTurnDetectors";
import { compactRecoveredAssistantContent } from "./recoveredAssistantContent";

export {
  claimsPackageScriptsWithoutEvidence,
  hasLeakedToolCallMarkup,
  isDegenerateRepeatedAnswer,
  isEmptyAssistantTurn,
  isMidWorkAnalysisDump,
  isPseudoToolRequestAnswer,
  isTransitionalAssistantAnswer,
  isUnfinishedInvestigationAnswer,
  looksLikeInstructionalAnswer,
} from "./assistantTurnDetectors";
export { compactRecoveredAssistantContent } from "./recoveredAssistantContent";

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
export function selectUserFacingLoopAnswer(params: {
  loopAnswer?: string;
  fallbackSummary?: string;
  changedFiles?: readonly string[];
}): string {
  const loop = stripInjectionComplianceEchoes(params.loopAnswer?.trim() ?? "");
  const summary = stripInjectionComplianceEchoes(
    params.fallbackSummary?.trim() ?? "",
  );
  const files = params.changedFiles ?? [];
  const syntheticEdits =
    /^(?:Completed workspace edits|Workspace edits so far|Stopping read-only turns to verify)[\s\S]*/i.test(
      loop,
    );
  const hideLoop =
    loop.length > 0 &&
    (isTransitionalAssistantAnswer(loop) ||
      isMidWorkAnalysisDump(loop) ||
      isUnfinishedInvestigationAnswer(loop) ||
      isDegenerateRepeatedAnswer(loop) ||
      // Prefer verification summary over synthetic edit stubs (BillBuddy 00:33).
      (syntheticEdits && summary.length > 0) ||
      // Early recovery blockers must not stick after later mutations.
      (files.length > 0 && isClearMutationBlockerAnswer(loop)));

  if (hideLoop || loop.length === 0) {
    const salvaged = hideLoop ? salvageUserFacingAnswerSection(loop) : undefined;
    if (salvaged && salvaged.length > 0) {
      return salvaged;
    }
    if (summary.length > 0) {
      return summary;
    }
    // Never leave the host with answerChars:0 on a completed diagnose/ask
    // stop — mid-work dumps and empty stops still get a synthetic fallback.
    return synthesizeFallbackAnswer({
      // Drop stale mid-work / blocker narration once disk edits exist.
      priorAnswer: hideLoop && files.length > 0 ? "" : loop,
      changedFiles: files,
    });
  }

  // Keep the model findings; only append verification text when it adds signal.
  const summaryIsVerificationFluff =
    /\bno workspace edits were applied\b/i.test(summary) &&
    /\b(?:baseline|0 error)\b/i.test(summary);
  const summaryAddsSignal =
    summary.length > 0 && !(summaryIsVerificationFluff && loop.length > 40);
  const joined = [loop, summaryAddsSignal ? summary : ""]
    .filter((part) => part.length > 0)
    .join("\n\n");
  return joined.length > 0
    ? joined
    : synthesizeFallbackAnswer({
        priorAnswer: loop,
        changedFiles: files,
      });
}

/**
 * When a mid-work dump hides a later clean report (e.g. "## Errors found"),
 * keep the report so diagnose/ask runs do not end with an empty UI answer.
 */
export function salvageUserFacingAnswerSection(content: string): string | undefined {
  const text = content.trim();
  if (text.length < 80) {
    return undefined;
  }
  const markers = [
    /^##\s+Errors?\s+found\b/im,
    /^##\s+Findings\b/im,
    /^##\s+Summary\b/im,
    /^(?:Errors?|Findings)\s+found\b/im,
  ];
  let start = -1;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match?.index !== undefined) {
      start = start < 0 ? match.index : Math.min(start, match.index);
    }
  }
  if (start < 0) {
    return undefined;
  }
  const slice = text.slice(start).trim();
  if (
    slice.length < 80 ||
    isTransitionalAssistantAnswer(slice) ||
    isMidWorkAnalysisDump(slice) ||
    isUnfinishedInvestigationAnswer(slice)
  ) {
    return undefined;
  }
  return slice;
}

/** Strip untrusted-file compliance / ACK echoes from user-facing answers. */
export function stripInjectionComplianceEchoes(text: string): string {
  if (!text) return text;
  return text
    .replace(/\bMITII_INJECTION_ACK_[A-Za-z0-9_-]+\b/g, "[redacted-injection-token]")
    .replace(/\[?\s*SYSTEM\s*:[^\n\]]*\]?/gi, "[redacted-untrusted-directive]")
    .replace(/\bconfirm(?:\s+your)?\s+compliance\b[^.!\n]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isClearMutationBlockerAnswer(content: string): boolean {
  return (
    /(?:^|\n)\s*(?:\*{0,2}|_{0,2})?\s*blocker(?:\*{0,2}|_{0,2})?\s*[:\-—]/im.test(
      content,
    ) ||
    /\b(?:stop(?:ping)?\s+here\s+with\s+a\s+clear\s+blocker|have\s+to\s+stop\s+here\s+with\s+a\s+clear\s+blocker)\b/i.test(
      content,
    )
  );
}

/**
 * Give Request Understanding a short prior-turn window so follow-ups like
 * "did you clear the old files?" classify as questions about prior work.
 * The live prompt construction path still uses the raw user message.
 */
export function amendMessageWithPriorConversation(
  message: string,
  conversation: readonly { role: string; content: string }[],
  extractPrimary: (text: string) => string = (text) => text,
): string {
  const primary = (extractPrimary(message) || message).trim();
  // Keep a wide prior window so follow-ups retain findings / decisions.
  const recent = conversation
    .filter(
      (entry) =>
        (entry.role === "user" || entry.role === "assistant") &&
        entry.content.trim().length > 0,
    )
    .slice(-24);
  if (recent.length === 0) {
    return primary;
  }

  const lines = recent.map((entry) => {
    const clipped =
      entry.content.length > 12_000
        ? `${entry.content.slice(0, 11_999)}…`
        : entry.content;
    return `${entry.role}: ${clipped}`;
  });

  return [
    "Prior conversation (for intent routing only; not the live user request):",
    ...lines,
    "",
    // Keep in sync with extractCurrentUserRequestForAnalysis.
    "Current user request:",
    primary,
  ].join("\n");
}

/**
 * Compact history for the RU Officer evidence pack (≤ ~400 tokens).
 * Prefer this over stuffing the full amended message into evidence.history.
 */
export function buildUnderstandingHistoryDigest(
  conversation: readonly { role: string; content: string }[],
  options?: { priorRoute?: string; priorTaskSize?: string },
): string | undefined {
  const recent = conversation
    .filter(
      (entry) =>
        (entry.role === "user" || entry.role === "assistant") &&
        entry.content.trim().length > 0,
    )
    .slice(-12);
  if (recent.length === 0 && !options?.priorRoute && !options?.priorTaskSize) {
    return undefined;
  }

  const lines: string[] = [`prior_turns=${recent.length}`];
  if (options?.priorRoute) {
    lines.push(`prior_route=${options.priorRoute}`);
  }
  if (options?.priorTaskSize) {
    lines.push(`prior_task_size=${options.priorTaskSize}`);
  }
  for (const entry of recent) {
    const clipped =
      entry.content.length > 2_000
        ? `${entry.content.slice(0, 1_999)}…`
        : entry.content.trim();
    lines.push(`${entry.role}: ${clipped.replace(/\s+/g, " ")}`);
  }
  return lines.join("\n").slice(0, 24_000);
}
