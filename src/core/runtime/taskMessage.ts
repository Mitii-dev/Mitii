const CONTINUATION_PREFIX = /^continue the current approved task from where it paused\b/i;

const SHORT_CONTINUATION =
  /^(?:add them|do it|yes\.?|go ahead\.?|please do\.?|continue\.?|proceed\.?|fix it\.?|try again\.?|same thing\.?)$/i;

/** Expand terse follow-ups ("add them") using the latest substantive user turn. */
export function resolveConversationTaskMessage(
  message: string,
  recentMessages: Array<{ role: string; content: string }> = []
): string {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 80 || isApprovalContinuationMessage(trimmed)) {
    return trimmed;
  }

  const looksLikeContinuation =
    SHORT_CONTINUATION.test(trimmed) ||
    (trimmed.length <= 40 &&
      !/\b(implement|build|create|refactor|migrate|audit|cleanup|debug)\b/i.test(trimmed) &&
      !/\.(?:tsx?|jsx?|py|go|rs|json|md|txt|csv)\b/i.test(trimmed));

  if (!looksLikeContinuation) return trimmed;

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const entry = recentMessages[index];
    if (entry.role !== 'user') continue;
    const prior = entry.content.trim();
    if (prior.length >= 20 && prior !== trimmed) {
      return `${trimmed}\n\n(Context from earlier request: ${prior})`;
    }
  }

  return trimmed;
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
