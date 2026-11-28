import type {
  RequestUnderstandingResult,
} from "../../request-understanding";
import {
  DECISION_POLICY_THRESHOLDS,
} from "../rules";
import {
  isConcreteLocalizedMutationAsk,
  isLocalizedSmallClearAsk,
} from "./ClassifySharedScopeRepair";
import {
  looksLikePastedTestFailureDump,
} from "./LooksLikeWorkspaceBugReport";
import {
  isDiagnosisIntent,
  isMutationIntent,
} from "./RouteIntents";
import {
  hasExplicitMutationPathTarget,
  hasResolvedClarification,
  isBareAmbiguousMutationAsk,
  looksLikeAgentMutationRequest,
  looksLikeAgentVerificationRequest,
  looksLikeWorkspaceGroundedRequest,
} from "./RouteMessageSignals";


export function needsRepositoryGrounding(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
  message: string,
): boolean {
  if (taskAnalysis.recommendsRepositoryDiscovery) {
    return true;
  }
  if (hasExplicitRepoTargets(taskAnalysis)) {
    return true;
  }
  if (
    taskAnalysis.scope === "repository" ||
    taskAnalysis.scope === "workspace" ||
    taskAnalysis.scope === "package" ||
    taskAnalysis.scope === "multi_file"
  ) {
    return true;
  }
  return looksLikeWorkspaceGroundedRequest(message);
}


export function requiresClarification(
  understanding: RequestUnderstandingResult,
  message: string,
  mode: "ask" | "plan" | "agent",
  continuationTurn = false,
): boolean {
  // Resume already amended the user ask with a clarification answer — do not
  // suspend again for the same ambiguity.
  if (hasResolvedClarification(message)) {
    return false;
  }

  if (looksLikeAgentVerificationRequest(message)) {
    return false;
  }

  // Pasted vitest/jest failure dumps are already actionable — do not stall
  // agent mode behind clarify when the LLM marks clarity unclear. Keep
  // investigate-vs-fix forks clarifying (those are not paste dumps).
  if (mode === "agent" && looksLikePastedTestFailureDump(message)) {
    return false;
  }

  const { intent, taskAnalysis } = understanding;
  const materialFork = isMaterialCapabilityFork(understanding, message);

  // clear localized UI / "change X to Y" asks must not suspend on
  // soft Officer ambiguity (nav-label / chip false-clarify class).
  if (
    mode === "agent" &&
    !materialFork &&
    (isConcreteLocalizedMutationAsk(message) ||
      isLocalizedSmallClearAsk({ taskAnalysis, message }))
  ) {
    return false;
  }

  // Agent mode: clear actionable mutation asks should execute even when
  // understanding marks soft ambiguity (avoids stalling "implement X" work).
  // Do NOT skip when alternatives fork read vs write (investigate vs fix),
  // or when clarity is unclear at/below low confidence (ask the user).
  if (
    mode === "agent" &&
    looksLikeAgentMutationRequest(message) &&
    !isBareAmbiguousMutationAsk(message) &&
    !materialFork &&
    !(
      taskAnalysis.clarity === "unclear" &&
      intent.classification.confidence <=
        DECISION_POLICY_THRESHOLDS.lowIntentConfidence
    )
  ) {
    return false;
  }

  // Explicit intent clarify flags still win — Request Understanding clears
  // these on continuation turns via TurnKindIntentPolicy when appropriate.
  if (intent.status === "clarification_required") {
    return true;
  }
  if (intent.recommendsClarification) {
    return true;
  }
  if (intent.classification.needsClarification) {
    return true;
  }

  // Continuation: soft clarity / task-analyzer ambiguity alone must not
  // re-suspend mid-run after Understanding deferred clarification.
  if (continuationTurn) {
    return false;
  }

  if (
    taskAnalysis.recommendsTaskClarification &&
    taskAnalysis.clarity === "unclear"
  ) {
    return true;
  }

  if (
    taskAnalysis.clarity === "unclear" &&
    intent.classification.confidence <=
      DECISION_POLICY_THRESHOLDS.lowIntentConfidence
  ) {
    return true;
  }

  if (
    taskAnalysis.clarity === "unclear" &&
    intent.confidenceMargin < DECISION_POLICY_THRESHOLDS.minimumIntentMargin &&
    intent.classification.alternatives.length > 0
  ) {
    return true;
  }

  return false;
}


/**
 * Clarify when the fork changes what the agent is allowed to do (read vs write)
 * or confidence is too low to guess. Clear "Add app/error.tsx" / "implement X"
 * asks with soft ambiguity flags are not material forks.
 */
function isMaterialCapabilityFork(
  understanding: RequestUnderstandingResult,
  message = "",
): boolean {
  const { intent } = understanding;
  const classification = intent.classification;
  const flagged =
    intent.status === "clarification_required" ||
    intent.recommendsClarification ||
    classification.needsClarification;
  if (!flagged) {
    return false;
  }

  const intents = new Set<string>([
    classification.primaryTaskIntent,
    ...classification.alternatives.map((alternative) => alternative.intent),
  ]);
  const hasDiagnoseSide = [...intents].some(
    (value) => isDiagnosisIntent(value) || value === "question",
  );
  const hasMutateSide = [...intents].some((value) => isMutationIntent(value));
  if (hasDiagnoseSide && hasMutateSide) {
    return true;
  }

  const ambiguityQuestion =
    classification.taskHints?.ambiguityQuestion?.trim() ?? "";
  if (
    ambiguityQuestion.length > 0 &&
    /\b(?:investigate|diagnos(?:e|is)|look\s+into|explain)\b/i.test(
      ambiguityQuestion,
    ) &&
    /\b(?:fix|implement|patch|change|edit)\b/i.test(ambiguityQuestion)
  ) {
    return true;
  }

  // Medium/low confidence with an explicit clarify flag — ask instead of
  // collapsing to a tool-less answer or a guessed write grant. Skip when the
  // user already named a concrete path / localized UI outcome.
  if (
    classification.confidence <
      DECISION_POLICY_THRESHOLDS.clarifyWhenFlaggedBelowConfidence
  ) {
    if (
      hasExplicitMutationPathTarget(message) ||
      isConcreteLocalizedMutationAsk(message)
    ) {
      return false;
    }
    return true;
  }

  return false;
}


function hasExplicitRepoTargets(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
): boolean {
  return taskAnalysis.targets.some(
    (target) =>
      target.explicit &&
      (target.kind === "file" ||
        target.kind === "folder" ||
        target.kind === "symbol" ||
        target.kind === "package" ||
        target.kind === "repository" ||
        target.kind === "workspace"),
  );
}
