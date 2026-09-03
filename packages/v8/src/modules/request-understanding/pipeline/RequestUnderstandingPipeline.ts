import type { LlmPort } from "../../model-gateway";
import {
  requestUnderstandingPipelineInputSchema,
  requestUnderstandingResultSchema,
} from "../contracts";
import type {
  DiagnosticSummary,
  RequestUnderstandingPipelineInput,
  RequestUnderstandingResult,
} from "../contracts";
import {
  extractCurrentUserRequestForAnalysis,
  extractPrimaryUserMessage,
} from "../intent/extractPrimaryUserMessage";
import { IntentRouter } from "../intent/IntentRouter";
import type { IntentRouterDependencies } from "../intent/types";
import { TaskAnalyzer } from "../task-analyzer/TaskAnalyzer";
import type { TaskAnalyzerDependencies } from "../task-analyzer/TaskAnalyzer";

export interface RequestUnderstandingPipelineDependencies {
  intentRouter?: IntentRouterDependencies;
  taskAnalyzer?: TaskAnalyzerDependencies;
}

export interface RequestUnderstandingOptions {
  diagnosticSummary?: DiagnosticSummary;
  /**
   * Optional workspace-relative paths (repo-map / catalog) for fuzzy file
   * target resolution after explicit extraction.
   */
  candidateRelativePaths?: readonly string[];
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
    diagnosticSummaryOrOptions?: DiagnosticSummary | RequestUnderstandingOptions,
    maybeOptions?: RequestUnderstandingOptions,
  ): Promise<RequestUnderstandingResult> {
    const envelope =
      requestUnderstandingPipelineInputSchema.parse(input);

    const options = normalizeUnderstandOptions(
      diagnosticSummaryOrOptions,
      maybeOptions,
    );

    const userMessage = extractPrimaryUserMessage(envelope.message);
    // Intent may see prior-turn context (follow-up status questions). Targets /
    // constraints must not inherit file paths from prior assistant answers.
    const analysisMessage = extractCurrentUserRequestForAnalysis(
      envelope.message,
    );

    const intent = await this.intentRouter.classify({
      mode: envelope.mode,
      userMessage,
      referencedArtifacts: envelope.referencedArtifacts,
      diagnosticSummary: options.diagnosticSummary,
    });

    const taskAnalysis = this.taskAnalyzer.analyze({
      userMessage: analysisMessage || userMessage,
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
      ...(options.candidateRelativePaths &&
      options.candidateRelativePaths.length > 0
        ? { candidateRelativePaths: [...options.candidateRelativePaths] }
        : {}),
    });

    return requestUnderstandingResultSchema.parse({
      intent,
      taskAnalysis,
    });
  }
}

function normalizeUnderstandOptions(
  diagnosticSummaryOrOptions?: DiagnosticSummary | RequestUnderstandingOptions,
  maybeOptions?: RequestUnderstandingOptions,
): RequestUnderstandingOptions {
  if (
    diagnosticSummaryOrOptions &&
    typeof diagnosticSummaryOrOptions === "object" &&
    "errorCount" in diagnosticSummaryOrOptions &&
    "diagnostics" in diagnosticSummaryOrOptions
  ) {
    return {
      diagnosticSummary: diagnosticSummaryOrOptions,
      candidateRelativePaths: maybeOptions?.candidateRelativePaths,
    };
  }

  if (
    diagnosticSummaryOrOptions &&
    typeof diagnosticSummaryOrOptions === "object"
  ) {
    const asOptions = diagnosticSummaryOrOptions as RequestUnderstandingOptions;
    return {
      diagnosticSummary:
        asOptions.diagnosticSummary ?? maybeOptions?.diagnosticSummary,
      candidateRelativePaths:
        asOptions.candidateRelativePaths ?? maybeOptions?.candidateRelativePaths,
    };
  }

  return {
    candidateRelativePaths: maybeOptions?.candidateRelativePaths,
  };
}
