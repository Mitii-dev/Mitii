import type { ResumePlan } from "../types";

/** Resume after external_side_effect_required (S10-EXT-EXTERNAL). */
export function resumeExternalSideEffect(input: {
  approved: boolean;
}): ResumePlan {
  if (!input.approved) {
    return {
      reenter: "complete",
      terminal: "cancelled",
      reasonCodes: ["resume_external_rejected"],
    };
  }
  return {
    reenter: "tool_settle",
    replayTool: true,
    reasonCodes: ["resume_external_approved"],
  };
}
