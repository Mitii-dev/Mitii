import type { EndingPosture } from "../../request-understanding";
import { isContinuationTurnKind } from "../../request-understanding";
import { isMutationIntent } from "./RouteIntents";

export type ContinuityPreferredRoute =
  | "execute"
  | "answer"
  | "plan"
  | "diagnose";

export interface ContinuityBiasInput {
  mode: "ask" | "plan" | "agent";
  turnKind?: "new" | "continue" | "steer" | "follow_up" | "recover";
  priorRoute?: string;
  endingPosture?: EndingPosture;
  interactionIntent?: "question" | "plan" | "act" | "help" | "unknown";
  primaryTaskIntent?: string;
  secondaryTaskIntents?: readonly string[];
  /** Host/runtime has an open execution checklist — prefer next slice. */
  openExecutionChecklist?: boolean;
}

export interface ContinuityBiasResult {
  preferredRoute?: ContinuityPreferredRoute;
  reasonCodes: string[];
}

const OPEN_WORK_POSTURES = new Set<EndingPosture>([
  "proposal_ready",
  "incomplete",
  "awaiting_approval",
]);

function stanceWantsAct(input: ContinuityBiasInput): boolean {
  if (input.interactionIntent === "act") return true;
  if (input.turnKind === "steer") return true;
  if (
    typeof input.primaryTaskIntent === "string" &&
    isMutationIntent(input.primaryTaskIntent)
  ) {
    return true;
  }
  return (input.secondaryTaskIntents ?? []).some((intent) =>
    isMutationIntent(intent),
  );
}

function stancePureQuestion(input: ContinuityBiasInput): boolean {
  if (stanceWantsAct(input)) return false;
  return (
    input.interactionIntent === "question" ||
    input.primaryTaskIntent === "question" ||
    input.primaryTaskIntent === "review" ||
    input.primaryTaskIntent === "docs"
  );
}

/**
 * Bias the next plate from prior route ending + user stance.
 * Ask mode never promotes to execute. Missing posture → no bias
 * (caller may apply a weak message fallback).
 */
export function applyContinuityBias(
  input: ContinuityBiasInput,
): ContinuityBiasResult {
  if (input.mode === "ask") {
    return { reasonCodes: [] };
  }
  if (input.mode === "plan") {
    return { reasonCodes: [] };
  }
  if (!isContinuationTurnKind(input.turnKind)) {
    return { reasonCodes: [] };
  }

  const wantsAct = stanceWantsAct(input);
  const pureQuestion = stancePureQuestion(input);

  // Open checklist is the campaign desk: Continue/next means execute the
  // next open item — not re-plan or re-research — unless the user is clearly
  // asking a read-only question about the work.
  if (input.openExecutionChecklist === true && !pureQuestion) {
    return {
      preferredRoute: "execute",
      reasonCodes: ["continuity_open_checklist"],
    };
  }

  if (!input.endingPosture) {
    return { reasonCodes: [] };
  }

  const posture = input.endingPosture;

  if (OPEN_WORK_POSTURES.has(posture)) {
    if (wantsAct) {
      return {
        preferredRoute: "execute",
        reasonCodes: ["continuity_bias_execute"],
      };
    }
    if (pureQuestion) {
      return {
        preferredRoute: "answer",
        reasonCodes: ["continuity_bias_answer"],
      };
    }
  }

  if (posture === "mutated") {
    if (wantsAct) {
      return {
        preferredRoute: "execute",
        reasonCodes: ["continuity_bias_execute"],
      };
    }
    if (pureQuestion) {
      return {
        preferredRoute: "answer",
        reasonCodes: ["continuity_bias_answer"],
      };
    }
  }

  if (posture === "awaiting_clarify" && wantsAct) {
    return {
      preferredRoute: "execute",
      reasonCodes: ["continuity_bias_execute"],
    };
  }

  if (posture === "answered" && wantsAct) {
    // New write after a closed Q&A — leave to normal plate / mutation signals.
    return { reasonCodes: ["continuity_answered_defer_plate"] };
  }

  return { reasonCodes: [] };
}
