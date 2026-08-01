/**
 * Prefer a substantive final answer; keep streamed text when the final answer
 * is empty/transitional so the chat does not collapse to a one-liner.
 * Keep in sync with apps/vscode/src/conversationCarry.ts resolveDisplayedAssistantText.
 */

const TRANSITIONAL_ASSISTANT =
  /^(?:okay[,.]?\s+|ok[,.]?\s+|sure[,.]?\s+)?(?:let me|i(?:'ll| will)|now let me)\b/i;

function isWeakAssistantDisplay(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 220 && TRANSITIONAL_ASSISTANT.test(trimmed)) return true;
  if (/^(?:\([\w_]+\)|Error:)/.test(trimmed) && trimmed.length < 80) return true;
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

  const finalWeak = isWeakAssistantDisplay(final);
  if (!finalWeak) return final;

  const streamedStronger =
    streamed.length > final.length * 1.35 ||
    (!isWeakAssistantDisplay(streamed) && streamed.length >= final.length);

  if (!streamedStronger) return final;

  const changedIdx = final.indexOf('Changed files (');
  if (changedIdx >= 0 && !streamed.includes('Changed files (')) {
    return `${streamed}\n\n${final.slice(changedIdx).trim()}`;
  }
  return streamed;
}
