/**
 * Append a campaign next-phase offer to a plan/verify terminal answer.
 */

import { appendNextPlanPhaseOffer } from "../../../../modules/planning";
import type { AgentReasonCode } from "../../contracts";

export function formatPlanAnswerWithNextPhase(params: {
  answer: string;
  nextPlanPhaseOffer?: string;
  reasonCodes: AgentReasonCode[];
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
