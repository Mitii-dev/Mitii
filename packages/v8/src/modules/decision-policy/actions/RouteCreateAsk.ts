import {
  isExplicitPlanRequest,
  isExplicitReadOnlyRequest,
  looksLikeAgentMutationRequest,
} from "./RouteMessageSignals";

/**
 * Explicit imperative "create X" asks in Agent mode.
 *
 * A classifier ballot that labels such an ask `plan` must not turn it into a
 * plan-only run: the user asked for artifacts, so the run must execute and
 * mutate. Plan-only still wins when the message itself asks for a plan,
 * proposal, roadmap, or is read-only constrained.
 */

const CREATE_VERBS =
  "create|build|implement|scaffold|generate|bootstrap|develop|add|write|make|set\\s+up";

const LEADING_CREATE_ASK = new RegExp(
  `^(?:(?:please|kindly)[\\s,]+)?(?:(?:can|could|would)\\s+you\\s+|i\\s+(?:want|need)\\s+you\\s+to\\s+|i\\s+need\\s+to\\s+|we\\s+need\\s+to\\s+|let(?:'s|\\s+us)\\s+)?(?:${CREATE_VERBS})\\s+(?:a|an|the|new|me|my|some|our|this)?\\s*[\\w@./\`'"-]+`,
  "i",
);

/** Objects/words that mean the user wants a written plan, not artifacts. */
const PLAN_ONLY_LANGUAGE =
  /\b(?:plan|planning|roadmap|proposal|outline|strategy|brainstorm|options|alternatives|trade-?offs?)\b/i;

function stripClarification(message: string): string {
  return message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
}

export function isExplicitCreateAsk(message: string): boolean {
  const text = stripClarification(message);
  if (text.length === 0) {
    return false;
  }
  if (isExplicitReadOnlyRequest(text) || isExplicitPlanRequest(text)) {
    return false;
  }
  if (PLAN_ONLY_LANGUAGE.test(text)) {
    return false;
  }
  if (!looksLikeAgentMutationRequest(text)) {
    return false;
  }
  return LEADING_CREATE_ASK.test(text);
}
