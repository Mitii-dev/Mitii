import { describe, expect, it } from "vitest";

import type {
  LlmPort,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
} from "../../../model-gateway";
import { RequestUnderstandingPipeline } from "../../flow/RequestUnderstandingPipeline";
import { assessDirection } from "../../helpers/direction/AssessDirection";
import { mapAssessmentToUnderstandingResult } from "../../helpers/direction/MapAssessmentToUnderstandingResult";
import type { RequestUnderstandingPipelineInput } from "../../contracts";

class UnusedLlmPort implements LlmPort {
  public readonly id = "unused-understanding-llm";
  public readonly capabilities: ModelCapabilities = {
    modelId: "test/unused",
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsStructuredOutput: true,
    supportsVision: false,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
  };

  public async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    throw new Error("legacy dual-path LLM must not run on assessment ballot");
  }
}

const envelope = (
  message: string,
): RequestUnderstandingPipelineInput =>
  ({
    schemaVersion: 1,
    requestId: "req-1",
    sessionId: "ses-1",
    createdAt: "2026-07-25T12:00:00.000Z",
    mode: "agent",
    origin: "user",
    message,
    turnKind: "new",
    referencedArtifacts: [],
  }) as RequestUnderstandingPipelineInput;

describe("understandViaAssessment (S2-RU)", () => {
  it("skips RuleIntent dual-path and keeps planning flags consistent", async () => {
    const pipeline = new RequestUnderstandingPipeline(new UnusedLlmPort());

    const result = await pipeline.understand(
      envelope("Refactor the auth module"),
      { useAssessmentBallot: true },
    );

    expect(result.intent.diagnostics.ruleSource).toBe("llm");
    expect(result.intent.diagnostics.taskAgreement).toBe(true);
    expect(result.intent.scores[0]?.ruleScore).toBe(0);
    expect(result.taskAnalysis.recommendsPlanning).toBe(
      result.taskAnalysis.planningHint !== "none",
    );
    expect(result.intent.classification.primaryTaskIntent).toBe("refactor");
  });

  it("mapAssessmentToUnderstandingResult mirrors planningHint dual flags", () => {
    const ballot = assessDirection({
      schemaVersion: 1,
      userCommand: "Plan a migration across the monorepo",
      mode: "agent",
    });
    const result = mapAssessmentToUnderstandingResult(ballot);
    expect(result.taskAnalysis.recommendsPlanning).toBe(
      result.taskAnalysis.planningHint !== "none",
    );
    expect(result.intent.diagnostics.taskAgreement).toBe(true);
  });
});
