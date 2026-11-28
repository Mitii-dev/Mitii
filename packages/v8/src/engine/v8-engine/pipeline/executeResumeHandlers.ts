import {
  amendMessageWithClarification,
  resolveClarificationAnswer,
} from "../actions";
import { formatClarificationAnswerFromPatch } from "../../../modules/request-understanding";
import { AgentEngineError } from "../contracts";
import type { AgentEngineStartInput, AgentRunResult } from "../contracts";
import { executeV8Start } from "./executeStart";
import type { ResumeHandlerContext } from "./resumeHandlerTypes";

export type { ResumeFinish, ResumeHandlerContext } from "./resumeHandlerTypes";
export { handleGrantExpansionResume } from "./executeResumeGrantExpansion";
export { handleContinueResume } from "./executeResumeContinue";
export { handleApprovalResume } from "./executeResumeApproval";
export { handlePlanApprovalResume } from "./executeResumePlanApproval";

export async function handleClarificationResume(
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
    reasonCodes,
  } = ctx;
  if (!input.clarificationAnswer) {
    throw new AgentEngineError(
      "invalid_input",
      "Resuming a clarification-required run requires clarificationAnswer.",
    );
  }
  await runtime.deps.checkpointStore!.delete(runId);
  reasonCodes.push("resume_complete");
  const patch = resolveClarificationAnswer(
    input.clarificationAnswer,
    checkpoint.clarificationSession,
  );
  const displayAnswer = patch
    ? formatClarificationAnswerFromPatch(patch)
    : input.clarificationAnswer;
  const clarifiedMessage = amendMessageWithClarification(
    startInput.request.userMessage,
    displayAnswer,
  );
  const amendedInput: AgentEngineStartInput = {
    ...startInput,
    request: {
      ...startInput.request,
      userMessage: clarifiedMessage,
    },
    conversation: [
      ...startInput.conversation,
      { role: "user", content: displayAnswer },
    ],
    ...(patch
      ? {
          clarificationResolution: {
            optionId: patch.optionId,
            ...(patch.label ? { label: patch.label } : {}),
            ...(patch.interactionIntent
              ? { interactionIntent: patch.interactionIntent }
              : {}),
            ...(patch.primaryTaskIntent
              ? { primaryTaskIntent: patch.primaryTaskIntent }
              : {}),
            ...(patch.targetPath ? { targetPath: patch.targetPath } : {}),
            ...(patch.scopeHint ? { scopeHint: patch.scopeHint } : {}),
            ...(patch.outcomeNote ? { outcomeNote: patch.outcomeNote } : {}),
          },
        }
      : {}),
  };
  return executeV8Start(runtime, {
    runId,
    input: amendedInput,
    bus,
    signal,
    getCancelReason,
  });
}
