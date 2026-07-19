const CONTINUATION_PREFIX = /^continue the current approved task from where it paused\b/i;

const SHORT_CONTINUATION =
  /^(?:add them|do it|yes\.?|go ahead\.?|please do\.?|continue\.?|proceed\.?|fix it\.?|try again\.?|same thing\.?)$/i;

/** Pronouns/adverbs that imply "continue what we were just discussing" (e.g. "analyse this", "again"). */
const REFERENTIAL_CONTINUATION_HINT = /\b(this|that|it|them|these|those|again|more|further|deeper|deeply)\b/i;

/** Either of these means the message already states its own scope — don't treat as a bare follow-up. */
const OWN_INTENT_HINT = /\b(implement|build|create|refactor|migrate|audit|cleanup|debug)\b/i;
const FILE_PATH_HINT = /\.(?:tsx?|jsx?|py|go|rs|json|md|txt|csv)\b/i;

export const CONVERSATION_CONTEXT_MARKER = '\n\n(Context from earlier request: ';

/** Expand terse follow-ups ("add them", "analyse this", "fix them") using the latest substantive user turn. */
export function resolveConversationTaskMessage(
  message: string,
  recentMessages: Array<{ role: string; content: string }> = []
): string {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 160 || isApprovalContinuationMessage(trimmed)) {
    return trimmed;
  }

  const hasOwnIntent = OWN_INTENT_HINT.test(trimmed) || FILE_PATH_HINT.test(trimmed);
  const looksLikeContinuation =
    SHORT_CONTINUATION.test(trimmed) ||
    (!hasOwnIntent && (trimmed.length <= 40 || REFERENTIAL_CONTINUATION_HINT.test(trimmed)));

  if (!looksLikeContinuation) return trimmed;

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const entry = recentMessages[index];
    if (entry.role !== 'user') continue;
    const prior = entry.content.trim();
    if (prior.length >= 20 && prior !== trimmed) {
      return `${trimmed}${CONVERSATION_CONTEXT_MARKER}${prior})`;
    }
  }

  return trimmed;
}

/**
 * Split off a "(Context from earlier request: …)" suffix appended by
 * resolveConversationTaskMessage. Heuristics that score task complexity/scope
 * should use only `primary` — the quoted prior turn can be long (pasted errors,
 * stack traces) and otherwise inflates complexity for genuinely small follow-ups.
 */
export function splitConversationContext(text: string): { primary: string; context?: string } {
  const index = text.indexOf(CONVERSATION_CONTEXT_MARKER);
  if (index === -1) return { primary: text };
  const primary = text.slice(0, index).trim();
  const context = text.slice(index + CONVERSATION_CONTEXT_MARKER.length).replace(/\)$/, '').trim();
  return { primary, context };
}

/** Extract the user's real request from an approval-continuation prompt. */
export function extractOriginalTaskMessage(message: string): string | null {
  const trimmed = message.trim();
  if (!CONTINUATION_PREFIX.test(trimmed)) return null;
  const marker = /\nOriginal user request:\s*\n/i;
  const match = marker.exec(trimmed);
  if (!match) return null;
  const original = trimmed.slice(match.index + match[0].length).trim();
  return original || null;
}

export function isApprovalContinuationMessage(message: string): boolean {
  return CONTINUATION_PREFIX.test(message.trim());
}
