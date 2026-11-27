import { applyAntiNagAsk } from "../helpers/ApplyAntiNagAsk";
import { applyContinuityBias } from "../helpers/ApplyContinuityBias";
import type { EndingPosture } from "../../request-understanding";
import { mapPlanningHintToDepth } from "../helpers/MapPlanningHintToDepth";
import { extractExplicitFilePaths } from "../helpers/ResolveFastPath";
import {
  looksLikeAgentExecuteContinue,
  looksLikeAgentMutationRequest,
} from "../helpers/RouteMessageSignals";
import { clarifyPlate } from "./routes/clarify";
import { answerResearchPlate } from "./routes/answer";
import { diagnosePlate } from "./routes/diagnose";
import { planVisiblePlate } from "./routes/plan";
import {
  executeFastPathPlate,
  executeMutatePlate,
  executeVisiblePlate,
} from "./routes/execute";
import type { DecisionPlate } from "./types";

export interface SelectDecisionPlateInput {
  mode: "ask" | "plan" | "agent";
  primaryTaskIntent: string;
  clarityConfidence: "low" | "medium" | "high";
  planningHint: "none" | "short" | "medium" | "long";
  askUser: boolean;
  risk?: "low" | "medium" | "high" | "critical";
  difficulty?: "trivial" | "simple" | "moderate" | "complex" | "very_complex";
  userQuestions?: readonly string[];
  clarificationQuestions?: readonly { blocking?: boolean }[];
  turnKind?: "new" | "continue" | "steer" | "follow_up" | "recover";
  /** Raw user message — agent mutation safety net when ballot says question. */
  message?: string;
  interactionIntent?: "question" | "plan" | "act" | "help" | "unknown";
  secondaryTaskIntents?: readonly string[];
  priorRoute?: string;
  endingPosture?: EndingPosture;
}

/**
 * Pick one plate from ballot + mode. Mode seals + anti-nag applied here.
 */
export function selectDecisionPlate(
  input: SelectDecisionPlateInput,
): DecisionPlate {
  const nag = applyAntiNagAsk({
    askUserSuggested: input.askUser,
    primaryTaskIntent: input.primaryTaskIntent,
    difficulty: input.difficulty,
    risk: input.risk,
    clarityConfidence: input.clarityConfidence,
    userQuestions: input.userQuestions,
    clarificationQuestions: input.clarificationQuestions,
    turnKind: input.turnKind,
  });

  // Plan mode seals first: discover → draft → after_plan gates. Soft ballot
  // clarify must not skip research with a tool-less handoff.
  if (input.mode === "plan") {
    return {
      ...planVisiblePlate,
      reasonCodes: [
        ...planVisiblePlate.reasonCodes,
        ...nag.reasonCodes,
        ...(nag.askUser ? ["plate_plan_mode_defers_anti_nag_clarify"] : []),
      ],
    };
  }

  if (nag.askUser) {
    return {
      ...clarifyPlate,
      reasonCodes: [...clarifyPlate.reasonCodes, ...nag.reasonCodes],
    };
  }

  const continuity = applyContinuityBias({
    mode: input.mode,
    turnKind: input.turnKind,
    priorRoute: input.priorRoute,
    endingPosture: input.endingPosture,
    interactionIntent: input.interactionIntent,
    primaryTaskIntent: input.primaryTaskIntent,
    secondaryTaskIntents: input.secondaryTaskIntents,
  });

  if (continuity.preferredRoute === "execute") {
    return withNag(executeFastPathPlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
    ]);
  }
  if (continuity.preferredRoute === "answer") {
    return withNag(answerResearchPlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
    ]);
  }
  if (continuity.preferredRoute === "diagnose") {
    return withNag(diagnosePlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
    ]);
  }
  if (continuity.preferredRoute === "plan") {
    return withNag(planVisiblePlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
    ]);
  }

  // Weak fallback when continuity was not stamped (old sessions / no sessionId).
  const continueTurn =
    input.turnKind === "follow_up" ||
    input.turnKind === "continue" ||
    input.turnKind === "steer";
  if (
    !input.endingPosture &&
    input.mode === "agent" &&
    continueTurn &&
    typeof input.message === "string" &&
    looksLikeAgentExecuteContinue(input.message)
  ) {
    return withNag(executeFastPathPlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
      "plate_agent_continue_as_execute",
    ]);
  }

  const intent = input.primaryTaskIntent.toLowerCase();

  if (intent === "diagnose" || intent === "bugfix") {
    if (input.mode === "ask") {
      return withNag(diagnosePlate, [
        ...nag.reasonCodes,
        ...continuity.reasonCodes,
      ]);
    }
    if (intent === "diagnose" || input.clarityConfidence !== "high") {
      return withNag(diagnosePlate, [
        ...nag.reasonCodes,
        ...continuity.reasonCodes,
      ]);
    }
  }

  if (intent === "question" || intent === "review") {
    // Agent mode: ballot often labels imperative mutation asks as "question"
    // ("Can you remove…?", "clear the tsconfig changes"). Mirror ResolveRoute's
    // looksLikeAgentMutationRequest safety net so we do not seal to research.
    if (
      input.mode === "agent" &&
      typeof input.message === "string" &&
      looksLikeAgentMutationRequest(input.message)
    ) {
      return withNag(executeFastPathPlate, [
        ...nag.reasonCodes,
        ...continuity.reasonCodes,
        "plate_agent_mutation_despite_question",
      ]);
    }
    return withNag(answerResearchPlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
    ]);
  }

  // Ask mode is read-only Q&A — never seal to a visible plan plate.
  if (input.mode === "ask") {
    return withNag(answerResearchPlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
      "plate_ask_mode_answer",
    ]);
  }

  const depthFromHint = mapPlanningHintToDepth(input.planningHint);
  const depthReason = `planning_hint_to_${depthFromHint}`;

  // Clear single-file create/edit asks should not force an empty visible plan
  // gate — execute directly (matches ResolvePlanningDepth fast_path spirit).
  const explicitPaths =
    typeof input.message === "string"
      ? extractExplicitFilePaths(input.message)
      : [];
  const localizedCreate =
    explicitPaths.length > 0 &&
    explicitPaths.length <= 4 &&
    typeof input.message === "string" &&
    looksLikeAgentMutationRequest(input.message) &&
    input.risk !== "high" &&
    input.risk !== "critical";

  if (
    (depthFromHint === "visible" ||
      input.risk === "high" ||
      input.risk === "critical") &&
    !localizedCreate
  ) {
    return withNag(executeVisiblePlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
      depthReason,
    ]);
  }
  if (localizedCreate && depthFromHint === "visible") {
    return withNag(executeFastPathPlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
      depthReason,
      "plate_localized_skip_visible_plan",
    ]);
  }
  if (depthFromHint === "internal") {
    return withNag(executeMutatePlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
      depthReason,
    ]);
  }
  if (
    intent === "feature" ||
    intent === "refactor" ||
    intent === "test" ||
    intent === "migrate" ||
    intent === "config" ||
    intent === "bugfix"
  ) {
    return withNag(executeFastPathPlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
      depthReason,
    ]);
  }

  // Agent follow-ups like "Start implementing it" may land as unclear/other —
  // still promote when the message is an imperative write ask.
  if (
    input.mode === "agent" &&
    typeof input.message === "string" &&
    looksLikeAgentMutationRequest(input.message)
  ) {
    return withNag(executeFastPathPlate, [
      ...nag.reasonCodes,
      ...continuity.reasonCodes,
      depthReason,
      "plate_agent_mutation_despite_question",
    ]);
  }

  return withNag(answerResearchPlate, [
    ...nag.reasonCodes,
    ...continuity.reasonCodes,
  ]);
}

function withNag(plate: DecisionPlate, nagCodes: string[]): DecisionPlate {
  if (nagCodes.length === 0) return plate;
  return {
    ...plate,
    reasonCodes: [...plate.reasonCodes, ...nagCodes],
  };
}
