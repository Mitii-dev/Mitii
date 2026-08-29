import { looksLikeAgentVerificationRequest } from "../../../modules/decision-policy";
import { WORKSPACE_BUG_FAILURE_LANGUAGE } from "../../../modules/decision-policy/patterns";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";

const QUESTION_OPENER =
  /^(?:is|are|was|were|does|do|did|have|has|can|could|should|would|what|where|when|why|who|how)\b/i;

const REPAIR_OR_MUTATION_VERB =
  /\b(?:fix|repair|resolve|patch|implement|add|update|refactor|migrate)\b/i;

/**
 * Agent mode captures a before-snapshot *before* Understand so compiler
 * errors can inform classification. That must not fire for status questions
 * ("is headless implemented??") or "run the tests" — those would otherwise
 * launch discovered e2e/WDIO scripts (or even tsc) before the model runs.
 */
export function shouldCaptureUnconditionalAgentPreflight(
  message: string,
): boolean {
  const text = extractPrimaryUserMessage(message).trim();
  if (text.length === 0) {
    return false;
  }

  if (looksLikeAgentVerificationRequest(text)) {
    return false;
  }

  if (!QUESTION_OPENER.test(text)) {
    return true;
  }

  return (
    WORKSPACE_BUG_FAILURE_LANGUAGE.test(text) ||
    REPAIR_OR_MUTATION_VERB.test(text)
  );
}
