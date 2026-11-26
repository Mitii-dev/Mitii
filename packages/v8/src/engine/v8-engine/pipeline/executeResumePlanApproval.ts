/**
 * Resume a plan-approval checkpoint after host approve/edit/reject.
 */
import type { PlanArtifact } from "../../../modules/planning";
import { formatPlanAsAnswer } from "../../../modules/planning";

import { AgentEngineError } from "../contracts";
import type { AgentRunResult } from "../contracts";
import { executeV8Start } from "./executeStart";
import { planApprovalResumeStartParams } from "./startReuse";
import type { ResumeHandlerContext } from "./resumeHandlerTypes";

export async function handlePlanApprovalResume(
  ctx: ResumeHandlerContext,
): Promise<AgentRunResult> {
  const {
    runtime,
    runId,
    input,
    checkpoint,
    startInput,
    bus,
    signal,
    getCancelReason,
    pinnedState,
    reasonCodes,
    finish,
  } = ctx;
  if (!input.planDecision) {
    throw new AgentEngineError(
      "invalid_input",
      "Resuming a plan-approval run requires planDecision.",
    );
  }
  if (input.planDecision.decision === "rejected") {
    await runtime.deps.checkpointStore!.delete(runId);
    await runtime.safeUnpin(runId, pinnedState);
    reasonCodes.push("plan_rejected", "resume_complete");
    return finish({
      status: "cancelled",
      plan: checkpoint.plan,
      answer: checkpoint.plan
        ? formatPlanAsAnswer(checkpoint.plan)
        : undefined,
      reasonCodes,
      error: {
        code: "plan_rejected",
        message: "The proposed plan was rejected.",
      },
    });
  }

  const nextPlan: PlanArtifact | undefined =
    input.planDecision.plan ?? checkpoint.plan;
  if (!nextPlan) {
    throw new AgentEngineError(
      "invalid_input",
      "Plan approval resume is missing a plan artifact.",
    );
  }

  await runtime.deps.checkpointStore!.delete(runId);
  reasonCodes.push(
    input.planDecision.decision === "edited"
      ? "plan_edited"
      : "plan_approved",
    "resume_complete",
  );
  return executeV8Start(runtime, {
    runId,
    input: startInput,
    bus,
    signal,
    getCancelReason,
    ...planApprovalResumeStartParams({
      checkpoint,
      decision: ctx.decision,
      plan: nextPlan,
      edited: input.planDecision.decision === "edited",
    }),
  });
}
