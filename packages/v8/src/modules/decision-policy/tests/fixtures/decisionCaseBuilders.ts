import type { AgentMode } from "../../../request-intake";
import type { DecisionPolicyInput } from "../../contracts";
import type { RequestUnderstandingResult } from "../../../request-understanding";

import type { DecisionCaseFixture } from "./decisionCaseTypes";

export function createUnderstanding(
  overrides: {
    primaryTaskIntent?: RequestUnderstandingResult["intent"]["classification"]["primaryTaskIntent"];
    interactionIntent?: RequestUnderstandingResult["intent"]["classification"]["interactionIntent"];
    confidence?: number;
    confidenceMargin?: number;
    needsClarification?: boolean;
    recommendsClarification?: boolean;
    status?: RequestUnderstandingResult["intent"]["status"];
    alternatives?: RequestUnderstandingResult["intent"]["classification"]["alternatives"];
    ambiguityQuestion?: string;
    taskAnalysis?: Partial<RequestUnderstandingResult["taskAnalysis"]>;
  } = {},
): RequestUnderstandingResult {
  const primary =
    overrides.primaryTaskIntent ?? "bugfix";
  const interaction = overrides.interactionIntent ?? "act";

  return {
    intent: {
      status: overrides.status ?? "accepted",
      classification: {
        interactionIntent: interaction,
        primaryTaskIntent: primary,
        secondaryTaskIntents: [],
        confidence: overrides.confidence ?? 0.9,
        alternatives: overrides.alternatives ?? [],
        needsClarification: overrides.needsClarification ?? false,
        reason: "Fixture classification.",
        ...(overrides.ambiguityQuestion
          ? {
              taskHints: {
                ambiguityQuestion: overrides.ambiguityQuestion,
              },
            }
          : {}),
      },
      scores: [
        {
          intent: primary,
          score: overrides.confidence ?? 0.9,
          ruleScore: 0.8,
          llmScore: 0.9,
        },
      ],
      confidenceMargin: overrides.confidenceMargin ?? 0.3,
      recommendsClarification: overrides.recommendsClarification ?? false,
      diagnostics: {
        llmPrimaryIntent: primary,
        llmInteractionIntent: interaction,
        taskAgreement: true,
        interactionAgreement: true,
        interactionConflict: false,
        agreementBonusApplied: 0,
        disagreementPenaltyApplied: 0,
        minimumConfidence: 0.6,
        minimumMargin: 0.15,
      },
    },
    taskAnalysis: {
      scope: "single_location",
      complexity: "simple",
      risk: "low",
      clarity: "clear",
      targets: [],
      constraints: [],
      requestedOutcomes: [],
      recommendsRepositoryDiscovery: true,
      recommendsPlanning: false,
      recommendsVerification: true,
      recommendsTaskClarification: false,
      estimatedFilesAffected: { minimum: 1, maximum: 1 },
      signals: [],
      confidence: 0.88,
      ...overrides.taskAnalysis,
    },
  };
}

export function createEnvelope(
  mode: AgentMode,
  message: string,
): DecisionPolicyInput["envelope"] {
  return {
    schemaVersion: 1,
    requestId: "req_decision_fixture",
    sessionId: "sess_decision_fixture",
    mode,
    origin: "user",
    turnKind: "new",
    message,
    referencedArtifacts: [],
    createdAt: "2026-07-25T12:00:00.000Z",
  };
}

export function createInput(
  fixture: Pick<
    DecisionCaseFixture,
    "mode" | "message" | "understanding" | "repositoryState"
  > &
    Partial<
      Pick<
        DecisionPolicyInput,
        | "approvalMode"
        | "planApproval"
        | "windowPolicy"
        | "requiredMcpServerIds"
      >
    >,
): DecisionPolicyInput {
  return {
    schemaVersion: 1,
    envelope: createEnvelope(fixture.mode, fixture.message),
    understanding: fixture.understanding,
    repositoryState: fixture.repositoryState,
    approvalMode: fixture.approvalMode,
    planApproval: fixture.planApproval,
    windowPolicy: fixture.windowPolicy,
    requiredMcpServerIds: fixture.requiredMcpServerIds,
  };
}
