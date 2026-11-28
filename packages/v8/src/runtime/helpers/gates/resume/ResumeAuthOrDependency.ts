import type { ResumePlan } from "../types";

export type AuthOrDependencyAction = "connected" | "skip_fallback" | "cancel";

/**
 * Resume after auth_or_dependency_required (S10-EXT-AUTH).
 * connected → retry tool; skip_fallback → continue without dependency; cancel → terminal.
 */
export function resumeAuthOrDependency(input: {
  action: AuthOrDependencyAction;
}): ResumePlan {
  switch (input.action) {
    case "connected":
      return {
        reenter: "tool_settle",
        replayTool: true,
        reasonCodes: ["resume_auth_connected"],
      };
    case "skip_fallback":
      return {
        reenter: "loop",
        reasonCodes: ["resume_auth_skip_fallback"],
      };
    case "cancel":
    default:
      return {
        reenter: "complete",
        terminal: "cancelled",
        reasonCodes: ["resume_auth_cancelled"],
      };
  }
}
