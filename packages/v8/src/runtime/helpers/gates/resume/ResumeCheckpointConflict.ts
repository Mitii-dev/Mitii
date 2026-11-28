import type { ResumePlan } from "../types";

export function resumeCheckpointConflict(input: {
  action: "resync" | "force" | "cancel";
}): ResumePlan {
  if (input.action === "cancel") {
    return {
      reenter: "complete",
      terminal: "cancelled",
      reasonCodes: ["resume_conflict_cancel"],
    };
  }
  if (input.action === "resync") {
    return { reenter: "orient", reasonCodes: ["resume_conflict_resync"] };
  }
  return { reenter: "loop", reasonCodes: ["resume_conflict_force"] };
}
