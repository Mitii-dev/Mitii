/**
 * Detect Plan follow-up asks that reference prior turns ("plan the above", etc.).
 */

const FOLLOW_UP_PLAN_QUERY =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:fix|update|change|check|do|handle|implement)\s+(?:it|this|that)\b/i;

/** "plan the above / plan that / for implementation / based on above" */
const FOLLOW_UP_PLAN_REFERENCE =
  /(?:\bplan\b.{0,40}\b(?:above|that|this|it)\b|\b(?:above|prior|previous)\b.{0,40}\b(?:plan|implement)|(?:for|to)\s+implement(?:ation)?\b|\bbased\s+on\s+(?:the\s+)?(?:above|prior|previous)\b)/i;

export function isPlanningFollowUp(
  currentQuery: string,
  conversation: readonly { role: string; content: string }[],
): boolean {
  const hasPriorTurns = conversation.some(
    (entry) =>
      (entry.role === "user" || entry.role === "assistant") &&
      entry.content.trim().length > 0,
  );
  if (!hasPriorTurns) {
    return false;
  }

  const current = currentQuery.trim().replace(/\s+/g, " ");
  if (
    FOLLOW_UP_PLAN_QUERY.test(current) ||
    FOLLOW_UP_PLAN_REFERENCE.test(current)
  ) {
    return true;
  }

  return (
    current.length < 80 &&
    /\bplan\b.{0,24}\b(?:above|that|this|it)\b/i.test(current)
  );
}
