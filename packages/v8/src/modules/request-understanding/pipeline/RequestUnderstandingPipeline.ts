import type { LlmPort } from "../../model-gateway";
import {
  requestUnderstandingPipelineInputSchema,
  requestUnderstandingResultSchema,
} from "../contracts";
import type {
  RequestUnderstandingPipelineInput,
  RequestUnderstandingResult,
} from "../contracts";
import { extractPrimaryUserMessage } from "../intent/extractPrimaryUserMessage";
import { IntentRouter } from "../intent/IntentRouter";
import type { IntentRouterDependencies } from "../intent/types";
import { TaskAnalyzer } from "../task-analyzer/TaskAnalyzer";
import type { TaskAnalyzerDependencies } from "../task-analyzer/TaskAnalyzer";

export interface RequestUnderstandingPipelineDependencies {
  intentRouter?: IntentRouterDependencies;
  taskAnalyzer?: TaskAnalyzerDependencies;
}

export class RequestUnderstandingPipeline {
  private readonly intentRouter: IntentRouter;
  private readonly taskAnalyzer: TaskAnalyzer;

  constructor(
    llmPort: LlmPort,
    dependencies: RequestUnderstandingPipelineDependencies = {},
  ) {
    this.intentRouter = new IntentRouter(
      llmPort,
      dependencies.intentRouter,
    );
    this.taskAnalyzer = new TaskAnalyzer(dependencies.taskAnalyzer);
  }

  public async understand(
    input: RequestUnderstandingPipelineInput,
  ): Promise<RequestUnderstandingResult> {
    const envelope =
      requestUnderstandingPipelineInputSchema.parse(input);

    const userMessage = extractPrimaryUserMessage(envelope.message);

    const intent = await this.intentRouter.classify({
      mode: envelope.mode,
      userMessage,
      referencedArtifacts: envelope.referencedArtifacts,
    });

    const taskAnalysis = this.taskAnalyzer.analyze({
      userMessage,
      intent,
      referencedArtifacts: envelope.referencedArtifacts.map((artifact) => ({
        name: artifact.name,
        path: artifact.path,
        kind:
          artifact.kind === "symbol"
            ? "selection"
            : artifact.kind,
        extension: artifact.extension,
        language: artifact.language,
      })),
    });

    return requestUnderstandingResultSchema.parse({
      intent,
      taskAnalysis,
    });
  }
}
