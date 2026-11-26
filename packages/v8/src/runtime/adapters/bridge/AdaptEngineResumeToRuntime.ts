import type { AgentEngineResumeInput } from "../../../engine/v8-engine/contracts";

/** Shape accepted by RuntimePipeline.resume. */
export interface AdaptedEngineResume {
  runId: string;
  message: string;
  mode?: "ask" | "plan" | "agent";
  decision:
    | "continue"
    | "approve"
    | "reject"
    | "clarify_answer"
    | "expand_grant";
  target?: "plan" | "mutation" | "grant";
  clarifyAnswer?: string;
  guidance?: string;
}

/**
 * Map engine resume envelope → runtime resume decision + target.
 * `fallbackMessage` is the prior start message when checkpoint hydrate is absent.
 */
export function adaptEngineResumeToRuntime(params: {
  input: AgentEngineResumeInput;
  fallbackMessage: string;
  mode?: "ask" | "plan" | "agent";
}): AdaptedEngineResume {
  const { input, fallbackMessage, mode } = params;
  const base = { runId: input.runId, mode };

  if (input.clarificationAnswer) {
    return {
      ...base,
      decision: "clarify_answer",
      clarifyAnswer: input.clarificationAnswer,
      message: input.clarificationAnswer,
    };
  }

  if (input.approval) {
    return {
      ...base,
      decision: input.approval.decision === "approved" ? "approve" : "reject",
      target: "mutation",
      message: fallbackMessage,
    };
  }

  if (input.planDecision) {
    const approved = input.planDecision.decision === "approved";
    const rejected = input.planDecision.decision === "rejected";
    return {
      ...base,
      decision: approved ? "approve" : rejected ? "reject" : "continue",
      target: "plan",
      guidance:
        input.planDecision.decision === "edited" ? "plan_edited" : undefined,
      message: fallbackMessage,
    };
  }

  if (input.grantExpansion) {
    return {
      ...base,
      decision:
        input.grantExpansion.decision === "approved"
          ? "expand_grant"
          : "reject",
      target: "grant",
      message: fallbackMessage,
    };
  }

  if (input.continueDecision) {
    return {
      ...base,
      decision:
        input.continueDecision.decision === "continue" ? "continue" : "reject",
      guidance: input.continueDecision.guidance,
      message: input.continueDecision.guidance?.trim() || fallbackMessage,
    };
  }

  return {
    ...base,
    decision: "continue",
    message: fallbackMessage,
  };
}
