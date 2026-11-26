import type { ResumePlan } from "../types";

export function resumeMutationApproval(input: {
  approved: boolean;
}): ResumePlan {
  if (input.approved) {
    return {
      reenter: "tool_settle",
      replayTool: true,
      reasonCodes: ["resume_mutation_approved"],
    };
  }
  return { reenter: "loop", reasonCodes: ["resume_mutation_denied"] };
}
