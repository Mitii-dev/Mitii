import {
  PLANNING_SCHEMA_VERSION,
  PlanningPipeline,
  planningInputSchema,
} from "../index";
import type { LlmPort, ModelCapabilities } from "../../model-gateway";

export const FAKE_CAPABILITIES: ModelCapabilities = {
  modelId: "fake-planning-model",
  contextWindowTokens: 16_000,
  maximumOutputTokens: 4_000,
  supportsStreaming: true,
  supportsTools: false,
  supportsParallelToolCalls: false,
  supportsStructuredOutput: true,
  supportsVision: false,
  supportsReasoning: false,
  supportsPromptCaching: false,
  supportsEmbeddings: false,
};

export function fakeLlm(
  responses: readonly (
    | string
    | {
        content: string;
        finishReason?: "stop" | "length";
      }
  )[],
): LlmPort {
  let index = 0;
  return {
    id: "fake-planning-llm",
    capabilities: FAKE_CAPABILITIES,
    async *complete() {
      const response = responses[index++] ?? "";
      const content =
        typeof response === "string" ? response : response.content;
      const finishReason =
        typeof response === "string"
          ? ("stop" as const)
          : response.finishReason ?? ("stop" as const);
      yield { type: "content_delta" as const, content };
      yield { type: "completed" as const, finishReason };
    },
  };
}

export function baseInput(
  overrides: Record<string, unknown> = {},
): Parameters<PlanningPipeline["plan"]>[0] {
  return planningInputSchema.parse({
    schemaVersion: PLANNING_SCHEMA_VERSION,
    query: "Add SSO login without breaking password login",
    mode: "plan",
    route: "plan",
    planningDepth: "visible",
    evidence: {
      primaryIntent: "feature",
      secondaryIntents: [],
      interactionIntent: "plan",
      scope: "package",
      complexity: "complex",
      risk: "high",
      clarity: "partially_clear",
      targets: [{ kind: "folder", value: "src/auth", explicit: true }],
      constraints: ["Keep password login working"],
      requestedOutcomes: ["Add SSO login without breaking password login"],
      recommendsPlanning: true,
      recommendsVerification: true,
      changeImpact: ["code", "config", "security"],
    },
    processHints: ["auth_identity"],
    ...overrides,
  });
}
