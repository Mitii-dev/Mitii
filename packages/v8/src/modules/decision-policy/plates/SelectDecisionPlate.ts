import { applyAntiNagAsk } from "../helpers/ApplyAntiNagAsk";
import { mapPlanningHintToDepth } from "../helpers/MapPlanningHintToDepth";
import { looksLikeAgentMutationRequest } from "../helpers/RouteMessageSignals";
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

  if (nag.askUser) {
    return {
      ...clarifyPlate,
      reasonCodes: [...clarifyPlate.reasonCodes, ...nag.reasonCodes],
    };
  }

  if (input.mode === "plan") {
    return {
      ...planVisiblePlate,
      reasonCodes: [...planVisiblePlate.reasonCodes, ...nag.reasonCodes],
    };
  }

  const intent = input.primaryTaskIntent.toLowerCase();

  if (intent === "diagnose" || intent === "bugfix") {
    if (input.mode === "ask") {
      return withNag(diagnosePlate, nag.reasonCodes);
    }
    if (intent === "diagnose" || input.clarityConfidence !== "high") {
      return withNag(diagnosePlate, nag.reasonCodes);
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
        "plate_agent_mutation_despite_question",
      ]);
    }
    return withNag(answerResearchPlate, nag.reasonCodes);
  }

  // Ask mode is read-only Q&A — never seal to a visible plan plate.
  if (input.mode === "ask") {
    return withNag(answerResearchPlate, [
      ...nag.reasonCodes,
      "plate_ask_mode_answer",
    ]);
  }

  const depthFromHint = mapPlanningHintToDepth(input.planningHint);
  const depthReason = `planning_hint_to_${depthFromHint}`;

  if (
    depthFromHint === "visible" ||
    input.risk === "high" ||
    input.risk === "critical"
  ) {
    return withNag(executeVisiblePlate, [...nag.reasonCodes, depthReason]);
  }
  if (depthFromHint === "internal") {
    return withNag(executeMutatePlate, [...nag.reasonCodes, depthReason]);
  }
  if (
    intent === "feature" ||
    intent === "refactor" ||
    intent === "test" ||
    intent === "migrate" ||
    intent === "config" ||
    intent === "bugfix"
  ) {
    return withNag(executeFastPathPlate, [...nag.reasonCodes, depthReason]);
  }

  return withNag(answerResearchPlate, nag.reasonCodes);
}

function withNag(plate: DecisionPlate, nagCodes: string[]): DecisionPlate {
  if (nagCodes.length === 0) return plate;
  return {
    ...plate,
    reasonCodes: [...plate.reasonCodes, ...nagCodes],
  };
}
