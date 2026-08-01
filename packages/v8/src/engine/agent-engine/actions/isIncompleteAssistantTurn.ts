/**
 * Detect empty or transitional assistant turns that must not end a run.
 * Models often narrate ("Let me check…") then stop or return blank after tools.
 */

const TRANSITIONAL_OPENERS =
  /^(?:okay[,.]?\s+|ok[,.]?\s+|sure[,.]?\s+|alright[,.]?\s+|right[,.]?\s+)?(?:let me|i(?:'ll| will)|i(?:'m| am) going to|now let me|next[,]? (?:i(?:'ll| will)|let me)|i need to|i should)\b/i;

const TRANSITIONAL_INTENT =
  /\b(?:let me|i(?:'ll| will)|i(?:'m| am) going to)\b/i;

const TRANSITIONAL_CLOSERS =
  /(?::|\.\.\.|…)\s*$/;

/** Trailing intent after a short prior sentence: ". Let me …" / ", I'll …" */
const TRAILING_INTENT_CLAUSE =
  /[.!,;]\s*(?:let me|i(?:'ll| will)|i(?:'m| am) going to)\b[\s\S]{0,160}$/i;

export function isEmptyAssistantTurn(params: {
  content: string;
  toolCallCount: number;
}): boolean {
  return params.content.trim().length === 0 && params.toolCallCount === 0;
}

/**
 * True when the assistant text looks like mid-work narration rather than a
 * user-facing final answer (and no tools were requested this turn).
 */
export function isTransitionalAssistantAnswer(content: string): boolean {
  const text = content.trim();
  if (text.length === 0) return true;
  if (text.length > 600) return false;

  const singleBeat = text.split(/\n+/).filter((line) => line.trim().length > 0)
    .length <= 2;
  if (!singleBeat) return false;

  if (TRANSITIONAL_OPENERS.test(text) && TRANSITIONAL_CLOSERS.test(text)) {
    return true;
  }

  // Short "Let me …" / "Now …" without a concrete conclusion.
  if (
    TRANSITIONAL_OPENERS.test(text) &&
    text.length < 180 &&
    !/[.!]["']?\s*$/.test(text)
  ) {
    return true;
  }

  // Mid-text intent that still ends unfinished ("… Let me run …:")
  if (TRANSITIONAL_INTENT.test(text) && TRANSITIONAL_CLOSERS.test(text)) {
    return true;
  }

  // Conclusion sentence that trails into another intent clause.
  if (text.length < 280 && TRAILING_INTENT_CLAUSE.test(text)) {
    return true;
  }

  return false;
}

export function shouldRecoverIncompleteAssistantTurn(params: {
  content: string;
  toolCallCount: number;
  changedFileCount: number;
}): boolean {
  if (params.toolCallCount > 0) return false;
  if (isEmptyAssistantTurn(params)) return true;
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
    "Your previous reply looked like mid-task narration, not a final answer.",
    "Continue: call needed tools, or finish with a clear user-facing summary of what you did and the outcome.",
    "Do not end on transitional phrases like \"Let me…\" or \"Now let me…\".",
    changed,
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

export function synthesizeFallbackAnswer(params: {
  priorAnswer?: string;
  changedFiles: readonly string[];
}): string {
  const prior = params.priorAnswer?.trim() ?? "";
  const paths = params.changedFiles;
  if (paths.length > 0) {
    const list = paths.slice(0, 40).join(", ") + (paths.length > 40 ? ", …" : "");
    if (prior && !isTransitionalAssistantAnswer(prior)) {
      return `${prior}\n\nChanged files (${paths.length}): ${list}`;
    }
    return `Completed workspace edits (${paths.length} file${
      paths.length === 1 ? "" : "s"
    }): ${list}`;
  }
  if (prior && !isTransitionalAssistantAnswer(prior)) {
    return prior;
  }
  return (
    prior ||
    "I stopped without a complete final answer. Please ask a follow-up if you want me to continue."
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
  const recent = conversation
    .filter(
      (entry) =>
        (entry.role === "user" || entry.role === "assistant") &&
        entry.content.trim().length > 0,
    )
    .slice(-4);
  if (recent.length === 0) {
    return primary;
  }

  const lines = recent.map((entry) => {
    const clipped =
      entry.content.length > 600
        ? `${entry.content.slice(0, 599)}…`
        : entry.content;
    return `${entry.role}: ${clipped}`;
  });

  return [
    "Prior conversation (for intent routing only; not the live user request):",
    ...lines,
    "",
    "Current user request:",
    primary,
  ].join("\n");
}
