/**
 * Explicit mutation-blocker header (not the broader isClearMutationBlocker
 * heuristics — those false-positive on findings like "Missing auth").
 */
const EXPLICIT_BLOCKER_HEADER =
  /(?:^|\n)\s*(?:\*{0,2}|_{0,2})?\s*blocker(?:\*{0,2}|_{0,2})?\s*[:\-—]/im;

/**
 * Detect short recovery / verification narration that must not erase a prior
 * findings report when execute+write forces a follow-up turn.
 */
export function isLowValueAnswerFollowUp(content: string): boolean {
  const text = content.trim();
  if (text.length === 0) return true;
  if (EXPLICIT_BLOCKER_HEADER.test(text)) return true;
  if (
    /\bno workspace edits were applied\b/i.test(text) &&
    /\b(?:baseline|0 error|verification)\b/i.test(text)
  ) {
    return true;
  }
  if (
    /^(?:Completed workspace edits|Workspace edits so far|Stopping read-only turns to verify)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Keep customer-visible findings across mutation nudges and verification
 * wrap-ups. Latest substantive text still wins when it is a real continuation;
 * blockers / verification fluff append instead of replacing.
 */
export function preserveSubstantiveAssistantAnswer(
  prior: string,
  next: string,
): string {
  const previous = prior.trim();
  const incoming = next.trim();
  if (!previous) return incoming;
  if (!incoming) return previous;
  if (previous === incoming) return incoming;

  // Already retained (e.g. finalize path after engine merge).
  if (incoming.includes(previous) || previous.includes(incoming)) {
    return previous.length >= incoming.length ? previous : incoming;
  }

  const priorIsBlockerOnly = isLowValueAnswerFollowUp(previous);
  const nextIsLowValue = isLowValueAnswerFollowUp(incoming);

  if (!priorIsBlockerOnly && nextIsLowValue) {
    return `${previous}\n\n${incoming}`;
  }

  // Prefer a longer findings report over a short replacement that is not itself
  // clearly more complete (common when a second stop rewrites the same audit).
  if (
    !priorIsBlockerOnly &&
    !nextIsLowValue &&
    previous.length >= 400 &&
    incoming.length < previous.length * 0.55 &&
    !incoming.includes(previous.slice(0, Math.min(120, previous.length)))
  ) {
    return `${previous}\n\n${incoming}`;
  }

  return incoming;
}
