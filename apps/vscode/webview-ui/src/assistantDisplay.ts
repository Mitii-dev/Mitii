/**
 * Prefer a substantive final answer; keep streamed text when the final answer
 * is empty/transitional so the chat does not collapse to a one-liner.
 * Keep in sync with apps/vscode/src/conversationCarry.ts resolveDisplayedAssistantText
 * and packages/v8 isTransitionalAssistantAnswer heuristics.
 */

const TRANSITIONAL_OPENERS =
  /^(?:okay[,.]?\s+|ok[,.]?\s+|sure[,.]?\s+|alright[,.]?\s+|right[,.]?\s+)?(?:let me|i(?:'ll| will)|i(?:'m| am) going to|now let me|next[,]? (?:i(?:'ll| will)|let me)|i need to|i should)\b/i;
const TRANSITIONAL_INTENT =
  /\b(?:let me|i(?:'ll| will)|i(?:'m| am) going to)\b/i;
const TRANSITIONAL_CLOSERS = /(?::|\.\.\.|…)\s*$/;
const TRAILING_INTENT_CLAUSE =
  /[.!,;]\s*(?:let me|i(?:'ll| will)|i(?:'m| am) going to)\b[\s\S]{0,160}$/i;

const PLANNING_PHRASE =
  /\b(?:let me|i(?:'ll| will)|i(?:'m| am) going to|i need to|i should)\b/gi;

function isMidWorkAnalysisDump(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 800) return false;
  const planning = trimmed.match(PLANNING_PHRASE) ?? [];
  return planning.length >= 8;
}

function isWeakAssistantDisplay(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (/^(?:\([\w_]+\)|Error:)/.test(trimmed) && trimmed.length < 80) return true;
  if (/^Completed workspace edits\b/i.test(trimmed) && trimmed.length < 260) return true;
  if (/^Completed workspace edits\b[\s\S]*\bChanged files \(\d+\):/i.test(trimmed)) {
    return true;
  }
  if (isMidWorkAnalysisDump(trimmed)) return true;
  if (trimmed.length > 600) return false;

  const singleBeat =
    trimmed.split(/\n+/).filter((line) => line.trim().length > 0).length <= 2;
  if (!singleBeat) return false;

  if (TRANSITIONAL_OPENERS.test(trimmed) && TRANSITIONAL_CLOSERS.test(trimmed)) {
    return true;
  }
  if (
    TRANSITIONAL_OPENERS.test(trimmed) &&
    trimmed.length < 180 &&
    !/[.!]["']?\s*$/.test(trimmed)
  ) {
    return true;
  }
  if (TRANSITIONAL_INTENT.test(trimmed) && TRANSITIONAL_CLOSERS.test(trimmed)) {
    return true;
  }
  if (trimmed.length < 280 && TRAILING_INTENT_CLAUSE.test(trimmed)) {
    return true;
  }
  return false;
}

export function resolveDisplayedAssistantText(options: {
  streamedText: string;
  finalAnswer: string;
}): string {
  const streamed = options.streamedText.trim();
  const final = options.finalAnswer.trim();
  if (!final) return streamed || '(no answer)';
  if (!streamed) return final;
  if (isMidWorkAnalysisDump(streamed)) return final;

  const finalWeak = isWeakAssistantDisplay(final);
  if (!finalWeak) return final;

  const streamedStronger =
    streamed.length > final.length * 1.35 ||
    (!isWeakAssistantDisplay(streamed) && streamed.length >= final.length);

  if (!streamedStronger) return final;

  return streamed;
}
