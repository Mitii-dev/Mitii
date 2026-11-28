/**
 * S3A-EXIT — 3A.4 exit policy (§6.4).
 * COMPLETE (plan mode) · SUSPEND approval · continue internal · never readonly after approve.
 */

export type PlanExitKind =
  | "complete_plan_ready"
  | "suspend_plan_approval"
  | "suspend_clarify_hollow"
  | "continue_internal"
  | "skip";

export interface ResolvePlanExitInput {
  mode?: "ask" | "plan" | "agent";
  route?: string;
  planGate?: "none" | "required_before_execute";
  planningDepth?: "none" | "internal" | "visible";
  hollow?: boolean;
  /** Plan pipeline actually ran. */
  planRan?: boolean;
}

export interface ResolvePlanExitResult {
  kind: PlanExitKind;
  nextOnApprove?: "replate_execute" | "host_build";
  reasonCodes: string[];
}

export function resolvePlanExit(
  input: ResolvePlanExitInput,
): ResolvePlanExitResult {
  if (!input.planRan) {
    return { kind: "skip", reasonCodes: ["plan_exit_skipped_no_plan"] };
  }

  if (input.hollow) {
    // Agent keeps moving (research/execute) instead of a hollow "Plan needed"
    // clarify that strips the original ask on go-ahead resume.
    if (input.mode === "agent") {
      return {
        kind: "continue_internal",
        reasonCodes: ["plan_exit_hollow_agent_continue"],
      };
    }
    return {
      kind: "suspend_clarify_hollow",
      reasonCodes: ["plan_exit_hollow_clarify"],
    };
  }

  if (input.mode === "plan" || input.route === "plan") {
    return {
      kind: "complete_plan_ready",
      nextOnApprove: "host_build",
      reasonCodes: ["plan_exit_complete_plan_mode"],
    };
  }

  if (
    input.planningDepth === "visible" &&
    input.planGate === "required_before_execute"
  ) {
    return {
      kind: "suspend_plan_approval",
      nextOnApprove: "replate_execute",
      reasonCodes: ["plan_exit_suspend_approval"],
    };
  }

  if (input.planningDepth === "internal") {
    return {
      kind: "continue_internal",
      reasonCodes: ["plan_exit_continue_internal"],
    };
  }

  return {
    kind: "continue_internal",
    reasonCodes: ["plan_exit_continue_default"],
  };
}
