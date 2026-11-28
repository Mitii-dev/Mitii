/**
 * Normalize host-facing user text before route / continue / mutation signals.
 * Strips clarification tails and host pin envelopes so continue is not masked.
 */

const PIN_ENVELOPE_RE =
  /^User pinned these paths for this turn:\n(?:- .+\n)+\n*/i;
const PINNED_PATHS_RE = /^Pinned paths:\n(?:- .+\n)+\n*/i;
const CLARIFICATION_TAIL_RE = /\nClarification:\s*[\s\S]*$/i;
const CLARIFICATION_PRESENT_RE = /\nClarification:\s*\S+/i;

export function normalizeRouteMessage(message: string): string {
  let text = message.replace(CLARIFICATION_TAIL_RE, "").trim();
  text = text.replace(PIN_ENVELOPE_RE, "").trim();
  text = text.replace(PINNED_PATHS_RE, "").trim();
  return text;
}

/** True when the host appended a non-empty Clarification: tail. */
export function hasClarificationTail(message: string): boolean {
  return CLARIFICATION_PRESENT_RE.test(message);
}
