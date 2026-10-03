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
import { RuleIntentClassifier } from "../intent/classifiers/rule/RuleIntentClassifier";
import {
  buildUnderstandingEvidencePack,
  type UnderstandingEvidencePack,
} from "../intent/evidence";
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
  /** Engine-supplied short history for the Officer — not a full transcript. */
  historyDigest?: string;
  priorRoute?: string;
  priorTaskSize?: "small" | "medium" | "large";
  /** Host MCP servers relevant to this turn. */
  requiredMcpServerIds?: readonly string[];
  /** Optional catalog/host project fingerprint for the Officer evidence pack. */
  projectFingerprint?: import("../intent/evidence/UnderstandingEvidencePack").ProjectFingerprint;
}

export class RequestUnderstandingPipeline {
  private readonly intentRouter: IntentRouter;
  private readonly taskAnalyzer: TaskAnalyzer;
  private readonly ruleClassifier: RuleIntentClassifier;

  constructor(
    llmPort: LlmPort,
    dependencies: RequestUnderstandingPipelineDependencies = {},
  ) {
    this.ruleClassifier =
      (dependencies.intentRouter?.ruleClassifier as RuleIntentClassifier | undefined) ??
      new RuleIntentClassifier();
    this.intentRouter = new IntentRouter(llmPort, {
      ...dependencies.intentRouter,
      ruleClassifier:
        dependencies.intentRouter?.ruleClassifier ?? this.ruleClassifier,
    });
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

    const rulePriors =
      typeof this.ruleClassifier.listPriors === "function"
        ? this.ruleClassifier.listPriors(userMessage)
        : [];

    const evidence: UnderstandingEvidencePack = buildUnderstandingEvidencePack({
      mode: envelope.mode,
      turnKind: envelope.turnKind,
      origin: envelope.origin,
      messageText: userMessage,
      originalMessageLength: envelope.message.length,
      referencedArtifacts: envelope.referencedArtifacts,
      attachments: envelope.attachments,
      rulePriors,
      diagnosticSummary: options.diagnosticSummary,
      requiredMcpServerIds: options.requiredMcpServerIds,
      historyDigest: options.historyDigest,
      priorRoute: options.priorRoute,
      priorTaskSize: options.priorTaskSize,
      projectFingerprint: options.projectFingerprint,
    });

    const intent = await this.intentRouter.classify({
      mode: envelope.mode,
      userMessage,
      referencedArtifacts: envelope.referencedArtifacts,
      diagnosticSummary: options.diagnosticSummary,
      turnKind: envelope.turnKind,
      evidence,
    });

    const taskAnalysis = this.taskAnalyzer.analyze({
      userMessage: analysisMessage || userMessage,
      intent,
      referencedArtifacts: envelope.referencedArtifacts.map((artifact) => ({
        name: artifact.name,
        path: artifact.path,
        kind: artifact.kind,
        extension: artifact.extension,
        language: artifact.language,
      })),
      turnKind: envelope.turnKind,
      sizeDraft: evidence.sizeDraft,
      ...(options.candidateRelativePaths &&
      options.candidateRelativePaths.length > 0
        ? { candidateRelativePaths: [...options.candidateRelativePaths] }
        : {}),
    });

    return requestUnderstandingResultSchema.parse({
      intent,
      taskAnalysis,
      evidence,
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
      historyDigest: maybeOptions?.historyDigest,
      priorRoute: maybeOptions?.priorRoute,
      priorTaskSize: maybeOptions?.priorTaskSize,
      requiredMcpServerIds: maybeOptions?.requiredMcpServerIds,
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
      historyDigest: asOptions.historyDigest ?? maybeOptions?.historyDigest,
      priorRoute: asOptions.priorRoute ?? maybeOptions?.priorRoute,
      priorTaskSize: asOptions.priorTaskSize ?? maybeOptions?.priorTaskSize,
      requiredMcpServerIds:
        asOptions.requiredMcpServerIds ?? maybeOptions?.requiredMcpServerIds,
    };
  }

  return {
    candidateRelativePaths: maybeOptions?.candidateRelativePaths,
    historyDigest: maybeOptions?.historyDigest,
    priorRoute: maybeOptions?.priorRoute,
    priorTaskSize: maybeOptions?.priorTaskSize,
    requiredMcpServerIds: maybeOptions?.requiredMcpServerIds,
  };
}
