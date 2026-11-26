/**
 * Append a campaign next-phase offer to a plan/verify terminal answer.
 */

import { appendNextPlanPhaseOffer } from "../../../modules/planning";

export function formatPlanAnswerWithNextPhase(params: {
  answer: string;
  nextPlanPhaseOffer?: string;
  reasonCodes: string[];
}): string {
  if (!params.nextPlanPhaseOffer?.trim()) {
    return params.answer;
  }
  const merged = appendNextPlanPhaseOffer(
    params.answer,
    params.nextPlanPhaseOffer,
  );
  if (!params.reasonCodes.includes("plan_next_phase_offered")) {
    params.reasonCodes.push("plan_next_phase_offered");
  }
  return merged;
}
