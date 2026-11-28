export function escalatePreferredBatchSize(
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

export function escalateMaxPatches(maxPatches: number, recoveryAttempt: number): number {
  if (recoveryAttempt <= 0) {
    return Math.max(1, maxPatches);
  }
  if (recoveryAttempt === 1) {
    return Math.max(1, Math.floor(maxPatches / 2));
  }
  return 1;
}

export function buildReasoningOrTruncationNudge(params: {
  reasoningAbort: boolean;
  emptyReasoningBurn: boolean;
  forcePatch: boolean;
  preferred: number;
  maxPatches: number;
  recoveryAttempt: number;
  checklistWorkRemains: boolean;
}): string {
  const opener = params.reasoningAbort
    ? params.emptyReasoningBurn
      ? "Your previous turn spent the whole budget on internal reasoning and never emitted a tool call or user-facing answer."
      : "Your previous turn spent too long on internal reasoning instead of a tool call or user-facing answer."
    : params.emptyReasoningBurn
      ? "Your previous turn hit the output token limit while writing internal reasoning only (no tools, no user-facing answer)."
      : "Your previous turn hit the output token limit while writing internal analysis/reasoning, not a user-facing answer.";

  const lines = [opener, "Do not continue that essay."];
  if (params.forcePatch) {
    if (params.checklistWorkRemains) {
      lines.push(
        `Checklist work remains. Call apply_patch now with a bounded batch: at most ${params.preferred} files (hard max ${params.maxPatches} patches).`,
      );
      lines.push(
        "If you need one short read first, call read_file or document_symbol on a path already named in the request or checklist, then patch.",
      );
    } else if (params.reasoningAbort) {
      // Reasoning abort: allow a targeted read — the model often never loaded
      // the write target because thinking burned the turn (DeepSeek/GLM logs).
      lines.push(
        `Call apply_patch now with a bounded batch: at most ${params.preferred} files (hard max ${params.maxPatches} patches).`,
      );
      lines.push(
        "A single targeted read_file/document_symbol of the write target is allowed if its contents are missing; then patch. Do not resume broad search.",
      );
    } else {
      lines.push(
        `Call apply_patch now with a smaller batch: at most ${params.preferred} files (hard max ${params.maxPatches} patches). Do not call read_file, search_files, list_directory, or analyze_change_impact on this turn — patch the remaining diagnostic errors already in context.`,
      );
    }
  } else {
    lines.push(
      "Give a short final answer to the user now (or call one essential tool). Do not restate your plan.",
    );
  }
  return lines.join("\n");
}

export function buildTextContinuationNudge(recoveryAttempt: number): string {
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

