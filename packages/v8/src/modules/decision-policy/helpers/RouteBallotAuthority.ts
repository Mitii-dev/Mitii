import {
  isHardWholeRequestReadOnlyConstraint,
} from "../../request-understanding";
import type {
  RequestUnderstandingResult,
} from "../../request-understanding";
import type {
  DecisionReasonCode,
} from "../contracts";
import {
  DECISION_POLICY_THRESHOLDS,
} from "../rules";
import {
  isMutationIntent,
} from "./RouteIntents";
import {
  isExplicitReadOnlyRequest,
  looksLikeAgentMutationRequest,
  looksLikePastedTestFailureReport,
} from "./RouteMessageSignals";


export function isHighConfidenceUnderstanding(
  understanding: RequestUnderstandingResult,
): boolean {
  const { intent } = understanding;
  return (
    intent.status === "accepted" &&
    !intent.recommendsClarification &&
    !intent.classification.needsClarification &&
    intent.classification.confidence >=
      DECISION_POLICY_THRESHOLDS.factsFirstMinConfidence &&
    intent.confidenceMargin >= DECISION_POLICY_THRESHOLDS.factsFirstMinMargin
  );
}


/**
 * ≥70% LLM/understanding act or mutation ballot without a clarify flag.
 * Same authority threshold as SuperIntent HIGH_CONFIDENCE — applies to
 * follow-ups as well as first turns.
 */
export function understandingTrustsWriteBallot(
  understanding: RequestUnderstandingResult,
): boolean {
  const { intent } = understanding;
  const classification = intent.classification;
  if (
    intent.status === "clarification_required" ||
    intent.recommendsClarification ||
    classification.needsClarification
  ) {
    return false;
  }
  if (
    classification.confidence < DECISION_POLICY_THRESHOLDS.factsFirstMinConfidence
  ) {
    return false;
  }
  return (
    classification.interactionIntent === "act" ||
    isMutationIntent(classification.primaryTaskIntent)
  );
}


/**
 * Dump heuristic override: full write ballot, or soft Officer act+mutation on
 * structured test-failure pastes (vitest/jest) at ≥0.60 when status is accepted.
 */
export function officerAuthorizesWriteDespiteDump(
  understanding: RequestUnderstandingResult,
  message: string,
): boolean {
  if (understandingTrustsWriteBallot(understanding)) {
    return true;
  }
  if (!looksLikePastedTestFailureReport(message)) {
    return false;
  }
  const { intent } = understanding;
  const classification = intent.classification;
  if (intent.status !== "accepted") {
    return false;
  }
  if (classification.needsClarification) {
    return false;
  }
  if (classification.confidence < DECISION_POLICY_THRESHOLDS.softOfficerWriteMinConfidence) {
    return false;
  }
  return (
    classification.interactionIntent === "act" &&
    isMutationIntent(classification.primaryTaskIntent)
  );
}


/**
 * Hard read-only always blocks writes. Soft keyword "read-only" hits yield to a
 * trusted ≥70% write ballot (so "dont remove all… keep a few" cannot veto act).
 */
export function writeBlockedByReadOnlyConstraint(
  understanding: RequestUnderstandingResult,
  message: string,
  reasonCodes: DecisionReasonCode[],
): boolean {
  if (isHardWholeRequestReadOnlyConstraint(message)) {
    return true;
  }
  if (!isExplicitReadOnlyRequest(message)) {
    return false;
  }
  if (understandingTrustsWriteBallot(understanding)) {
    reasonCodes.push("policy_llm_authority_write");
    return false;
  }
  return true;
}


export function shouldGrantMutationExecute(params: {
  understanding: RequestUnderstandingResult;
  message: string;
  reasonCodes: DecisionReasonCode[];
}): boolean {
  const { understanding, message, reasonCodes } = params;
  const primary = understanding.intent.classification.primaryTaskIntent;
  const interaction = understanding.intent.classification.interactionIntent;

  if (writeBlockedByReadOnlyConstraint(understanding, message, reasonCodes)) {
    return false;
  }

  return (
    isMutationIntent(primary) ||
    interaction === "act" ||
    looksLikeAgentMutationRequest(message)
  );
}
