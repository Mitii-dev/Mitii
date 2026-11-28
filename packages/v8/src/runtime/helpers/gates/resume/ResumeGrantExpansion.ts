import type { ResumePlan } from "../types";

export function resumeGrantExpansion(input: {
  approved: boolean;
}): ResumePlan {
  if (input.approved) {
    return {
      reenter: "tool_settle",
      replayTool: true,
      replate: true,
      reasonCodes: ["resume_grant_expansion_approved"],
    };
  }
  return { reenter: "loop", reasonCodes: ["resume_grant_expansion_denied"] };
}
