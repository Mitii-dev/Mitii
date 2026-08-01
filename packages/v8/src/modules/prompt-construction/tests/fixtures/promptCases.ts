import {
  DecisionPolicyPipeline,
  type DecisionPolicyInput,
  type ExecutionDecision,
} from "../../../decision-policy";
import type { AgentMode } from "../../../request-intake";
import type { RequestUnderstandingResult } from "../../../request-understanding";
import type {
  ModelCapabilities,
  ModelToolDefinition,
} from "../../../model-gateway";

import type { PromptConstructionInput } from "../../contracts";

export function createCapabilities(
  overrides: Partial<ModelCapabilities> = {},
): ModelCapabilities {
  return {
    modelId: "test-model",
    contextWindowTokens: 8_192,
    maximumOutputTokens: 2_048,
    supportsStreaming: true,
    supportsTools: true,
    supportsParallelToolCalls: false,
    supportsStructuredOutput: false,
    supportsVision: false,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    ...overrides,
  };
}

function createUnderstanding(
  overrides: {
    primaryTaskIntent?: RequestUnderstandingResult["intent"]["classification"]["primaryTaskIntent"];
    interactionIntent?: RequestUnderstandingResult["intent"]["classification"]["interactionIntent"];
    taskAnalysis?: Partial<RequestUnderstandingResult["taskAnalysis"]>;
  } = {},
): RequestUnderstandingResult {
  const primary = overrides.primaryTaskIntent ?? "question";
  const interaction = overrides.interactionIntent ?? "question";

  return {
    intent: {
      status: "accepted",
      classification: {
        interactionIntent: interaction,
        primaryTaskIntent: primary,
        secondaryTaskIntents: [],
        confidence: 0.9,
        alternatives: [],
        needsClarification: false,
        reason: "Prompt construction fixture.",
      },
      scores: [
        {
          intent: primary,
          score: 0.9,
          ruleScore: 0.8,
          llmScore: 0.9,
        },
      ],
      confidenceMargin: 0.3,
      recommendsClarification: false,
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
      recommendsVerification: false,
      recommendsTaskClarification: false,
      estimatedFilesAffected: { minimum: 1, maximum: 1 },
      signals: [],
      confidence: 0.88,
      ...overrides.taskAnalysis,
    },
  };
}

function createDecisionInput(params: {
  mode: AgentMode;
  message: string;
  understanding: RequestUnderstandingResult;
}): DecisionPolicyInput {
  return {
    schemaVersion: 1,
    envelope: {
      schemaVersion: 1,
      requestId: "req_prompt_fixture",
      sessionId: "sess_prompt_fixture",
      mode: params.mode,
      origin: "user",
      message: params.message,
      referencedArtifacts: [],
      createdAt: "2026-07-25T12:00:00.000Z",
    },
    understanding: params.understanding,
    repositoryState: {
      reference: { workspaceId: "ws_1", stateToken: "st_prompt_1" },
      readiness: "ready",
    },
  };
}

export function createDecision(params: {
  mode?: AgentMode;
  message?: string;
  primaryTaskIntent?: RequestUnderstandingResult["intent"]["classification"]["primaryTaskIntent"];
  recommendsRepositoryDiscovery?: boolean;
} = {}): ExecutionDecision {
  const message =
    params.message ?? "Explain how src/util.ts handles null checks";

  return new DecisionPolicyPipeline().decide(
    createDecisionInput({
      mode: params.mode ?? "ask",
      message,
      understanding: createUnderstanding({
        primaryTaskIntent: params.primaryTaskIntent ?? "question",
        interactionIntent: "question",
        taskAnalysis: {
          recommendsRepositoryDiscovery:
            params.recommendsRepositoryDiscovery ?? true,
          recommendsPlanning: false,
          recommendsVerification: false,
        },
      }),
    }),
  );
}

export function createPromptInput(
  overrides: Partial<PromptConstructionInput> = {},
): PromptConstructionInput {
  const decision = overrides.decision ?? createDecision();
  return {
    schemaVersion: 1,
    decision,
    userMessage:
      overrides.userMessage ?? "Explain the null check in src/util.ts",
    conversation: overrides.conversation ?? [],
    repositoryContext: overrides.repositoryContext,
    instructions: overrides.instructions,
    tools: overrides.tools,
    capabilities: overrides.capabilities ?? createCapabilities(),
    model: overrides.model,
    temperature: overrides.temperature,
    stream: overrides.stream,
    outputReserveTokens: overrides.outputReserveTokens,
  };
}

export const SAMPLE_TOOLS: ModelToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a workspace file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "apply_patch",
    description: "Apply a patch",
    inputSchema: {
      type: "object",
      properties: { patch: { type: "string" } },
      required: ["patch"],
    },
  },
];
