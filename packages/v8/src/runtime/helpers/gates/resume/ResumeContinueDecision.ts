import type { ResumePlan } from "../types";

export function resumeContinueDecision(input: {
  action: "continue" | "stop";
  continueReason?: string;
}): ResumePlan {
  if (input.action === "stop") {
    return {
      reenter: "complete",
      terminal: "continue_stopped",
      reasonCodes: ["resume_continue_stopped"],
    };
  }
  const reenter =
    input.continueReason === "verification_repair_capped" ? "verify" : "loop";
  return {
    reenter,
    guidance:
      input.continueReason === "evidence_clarify"
        ? "do_not_force_mutate"
        : undefined,
    reasonCodes: ["resume_continue"],
  };
}
