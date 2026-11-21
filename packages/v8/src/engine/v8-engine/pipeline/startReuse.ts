import type { ExecutionDecision } from "../../../modules/decision-policy";
import {
  inferPlanStrategyFromArtifact,
  type PlanArtifact,
  type PlanStrategyDecision,
} from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import type { RepoBuildState } from "../../../modules/verification";

import {
  buildDiagnosticSummary,
  collectUnderstandingCandidatePaths,
} from "../actions";
import type { AgentEngineStartInput, AgentReasonCode } from "../contracts";
import type { AgentRunCheckpoint } from "../internal/RunCheckpoint";
import type { ExecutionSeed } from "../modules/execution-seed";
import { resolveExecutionSeed } from "../modules/execution-seed";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";

/**
 * State pinned at plan-approval suspension. Reusing it on resume means the
 * approved plan runs without paying pin, preflight, understanding, and
 * decision a second time.
 */
export type StartReuseState = {
  decision: ExecutionDecision;
  understanding: RequestUnderstandingResult;
  pinnedState: RepositoryStateReference | undefined;
  repoBuildStateBefore?: RepoBuildState;
  executionSeed?: ExecutionSeed;
};

/** Start params shared by every plan-approval resume (`executeV8Start`). */
export function planApprovalResumeStartParams(params: {
  checkpoint: AgentRunCheckpoint;
  decision: ExecutionDecision;
  plan: PlanArtifact;
  edited: boolean;
}): {
  approvedPlan: PlanArtifact;
  approvedPlanStrategy: PlanStrategyDecision;
  skipPlanGate: true;
  planSource: "resume_approval";
  reuse?: StartReuseState;
} {
  const { checkpoint, plan } = params;
  return {
    approvedPlan: plan,
    approvedPlanStrategy: params.edited
      ? inferPlanStrategyFromArtifact(plan)
      : checkpoint.planStrategy ?? inferPlanStrategyFromArtifact(plan),
    skipPlanGate: true,
    planSource: "resume_approval",
    ...(checkpoint.understanding
      ? {
          reuse: {
            decision: params.decision,
            understanding: checkpoint.understanding,
            pinnedState: checkpoint.pinnedState,
            repoBuildStateBefore: checkpoint.repoBuildStateBefore,
            executionSeed: checkpoint.executionSeed,
          },
        }
      : {}),
  };
}

/**
 * Seed `shared` from a plan-approval checkpoint and return the early-pipeline
 * continuation state without re-running pin / preflight / understand / decide.
 */
export function applyStartReuse(params: {
  reuse: StartReuseState;
  shared: ExecuteStartSharedState;
  reasonCodes: AgentReasonCode[];
  input: AgentEngineStartInput;
  envelope: UserRequestEnvelope;
}): {
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  candidateRelativePaths: string[];
  executionSeed: ExecutionSeed;
} {
  const { reuse, shared, envelope, input } = params;
  shared.pinnedState = reuse.pinnedState;
  shared.repoBuildStateBefore = reuse.repoBuildStateBefore;
  shared.route = reuse.decision.route;
  shared.planningDepth = reuse.decision.planningDepth;
  shared.understanding = reuse.understanding;

  const userMessage = extractPrimaryUserMessage(envelope.message);
  const diagnosticSummary = reuse.repoBuildStateBefore
    ? buildDiagnosticSummary(reuse.repoBuildStateBefore, userMessage)
    : undefined;
  const executionSeed =
    reuse.executionSeed ??
    resolveExecutionSeed({
      userPrompt: userMessage,
      understanding: reuse.understanding,
      repoBuildStateBefore: reuse.repoBuildStateBefore,
      ...(diagnosticSummary ? { diagnosticSummary } : {}),
    });
  shared.executionSeed = executionSeed;

  params.reasonCodes.push(
    "understanding_complete",
    "decision_complete",
    "resume_state_reused",
  );
  return {
    envelope,
    understanding: reuse.understanding,
    decision: reuse.decision,
    candidateRelativePaths: collectUnderstandingCandidatePaths({
      dirtyPaths: input.dirtyPaths,
      diagnosticSummary,
      referencedArtifacts: envelope.referencedArtifacts,
      userMessage,
    }),
    executionSeed,
  };
}
