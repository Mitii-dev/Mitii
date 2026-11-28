import type { ResumePlan } from "../types";

export function resumePlanDecision(input: {
  decision: "approve" | "steer" | "reject";
}): ResumePlan {
  if (input.decision === "approve") {
    return {
      reenter: "loop",
      replate: true,
      reasonCodes: ["resume_plan_approve_replate"],
    };
  }
  if (input.decision === "steer") {
    return { reenter: "after_plan", reasonCodes: ["resume_plan_steer"] };
  }
  return {
    reenter: "complete",
    terminal: "plan_rejected",
    reasonCodes: ["resume_plan_rejected"],
  };
}
