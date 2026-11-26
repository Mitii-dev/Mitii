import type { LlmPort } from "../../model-gateway";
import {
  REQUEST_UNDERSTANDING_IDS,
  REQUEST_UNDERSTANDING_REASON,
  REQUEST_UNDERSTANDING_STAGES,
} from "../constants";
import {
  requestUnderstandingPipelineInputSchema,
} from "../contracts";
import type {
  DiagnosticSummary,
  RequestUnderstandingPipelineInput,
  RequestUnderstandingResult,
} from "../contracts";
import { IntentRouter } from "../helpers/intent/IntentRouter";
import type { IntentRouterDependencies } from "../helpers/intent/types";
import { RuleIntentClassifier } from "../adapters/rule/RuleIntentClassifier";
import { TaskAnalyzer } from "../helpers/task-analyzer/TaskAnalyzer";
import type { TaskAnalyzerDependencies } from "../helpers/task-analyzer/TaskAnalyzer";
import {
  noopModuleLogger,
  type ModuleLoggerPort,
} from "../ports/ModuleLoggerPort";
import type { DirectionAnalysisInput } from "../contracts/input/DirectionAnalysisInput";
import type { TaskDirectionAssessment } from "../contracts/output/TaskDirectionAssessment";
import { assessDirectionWithLlm } from "../helpers/direction/AssessDirectionWithLlm";
import type { DirectionLlmComplete } from "../helpers/direction/AssessDirectionWithLlm";
import { extractUnderstandingMessages } from "./steps/1-extract-messages";
import { buildUnderstandingEvidence } from "./steps/2-build-evidence";
import { classifyUnderstandingIntent } from "./steps/3-classify-intent";
import { analyzeUnderstandingTask } from "./steps/4-analyze-task";
import { finalizeUnderstandingResult } from "./steps/5-finalize-result";
import type { RequestUnderstandingOptions } from "./types";

export type { RequestUnderstandingOptions } from "./types";

export interface RequestUnderstandingPipelineDependencies {
  intentRouter?: IntentRouterDependencies;
  taskAnalyzer?: TaskAnalyzerDependencies;
  log?: ModuleLoggerPort;
}

/**
 * Request Understanding facade.
 *
 * Flow (understand):
 *   1-extract-messages → 2-build-evidence → 3-classify-intent
 *   → 4-analyze-task → 5-finalize-result
 *
 * Flow (assessDirection): SituationPack-shaped ballot (§5) — DP owns authority.
 */
export class RequestUnderstandingPipeline {
  public readonly id = REQUEST_UNDERSTANDING_IDS.PIPELINE;
  private readonly intentRouter: IntentRouter;
  private readonly taskAnalyzer: TaskAnalyzer;
  private readonly ruleClassifier: RuleIntentClassifier;
  private readonly log: ModuleLoggerPort;

  constructor(
    llmPort: LlmPort,
    dependencies: RequestUnderstandingPipelineDependencies = {},
  ) {
    this.ruleClassifier =
      (dependencies.intentRouter?.ruleClassifier as
        | RuleIntentClassifier
        | undefined) ?? new RuleIntentClassifier();
    this.intentRouter = new IntentRouter(llmPort, {
      ...dependencies.intentRouter,
      ruleClassifier:
        dependencies.intentRouter?.ruleClassifier ?? this.ruleClassifier,
    });
    this.taskAnalyzer = new TaskAnalyzer(dependencies.taskAnalyzer);
    this.log = dependencies.log ?? noopModuleLogger;
  }

  public async understand(
    input: RequestUnderstandingPipelineInput,
    diagnosticSummaryOrOptions?: DiagnosticSummary | RequestUnderstandingOptions,
    maybeOptions?: RequestUnderstandingOptions,
  ): Promise<RequestUnderstandingResult> {
    const envelope = requestUnderstandingPipelineInputSchema.parse(input);

    const options = normalizeUnderstandOptions(
      diagnosticSummaryOrOptions,
      maybeOptions,
    );

    let stageStartedMs = Date.now();
    const { userMessage, analysisMessage } =
      extractUnderstandingMessages(envelope);
    this.log.stage({
      module: "request-understanding",
      stage: REQUEST_UNDERSTANDING_STAGES.extractMessages,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [REQUEST_UNDERSTANDING_REASON.messagesExtracted],
      outputSummary: {
        userMessageLength: userMessage.length,
        analysisMessageLength: analysisMessage.length,
      },
    });

    const rulePriors =
      typeof this.ruleClassifier.listPriors === "function"
        ? this.ruleClassifier.listPriors(userMessage)
        : [];

    stageStartedMs = Date.now();
    const evidence = buildUnderstandingEvidence({
      envelope,
      userMessage,
      rulePriors,
      options,
    });
    this.log.stage({
      module: "request-understanding",
      stage: REQUEST_UNDERSTANDING_STAGES.buildEvidence,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [REQUEST_UNDERSTANDING_REASON.evidenceBuilt],
      outputSummary: {
        rulePriorCount: rulePriors.length,
        taskSizeDraft: evidence.sizeDraft?.taskSize,
      },
    });

    stageStartedMs = Date.now();
    const intent = await classifyUnderstandingIntent({
      envelope,
      userMessage,
      evidence,
      options,
      intentRouter: this.intentRouter,
    });
    this.log.stage({
      module: "request-understanding",
      stage: REQUEST_UNDERSTANDING_STAGES.classifyIntent,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [
        REQUEST_UNDERSTANDING_REASON.intentClassified,
        ...(intent.diagnostics.officerFallback
          ? [`officer_fallback_${intent.diagnostics.officerFallback}`]
          : []),
      ],
      outputSummary: {
        status: intent.status,
        primaryTaskIntent: intent.classification?.primaryTaskIntent,
        confidenceMargin: intent.confidenceMargin,
        rulePrimary: intent.diagnostics.rulePrimaryIntent ?? null,
        llmPrimary: intent.diagnostics.llmPrimaryIntent,
        taskAgreement: intent.diagnostics.taskAgreement,
        officerFallback: intent.diagnostics.officerFallback ?? null,
        recommendsClarification: intent.recommendsClarification,
      },
    });

    stageStartedMs = Date.now();
    const taskAnalysis = analyzeUnderstandingTask({
      envelope,
      userMessage,
      analysisMessage,
      intent,
      evidence,
      options,
      taskAnalyzer: this.taskAnalyzer,
    });
    this.log.stage({
      module: "request-understanding",
      stage: REQUEST_UNDERSTANDING_STAGES.analyzeTask,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [REQUEST_UNDERSTANDING_REASON.taskAnalyzed],
      outputSummary: {
        taskSize: taskAnalysis.taskSize,
        planningHint: taskAnalysis.planningHint,
      },
    });

    stageStartedMs = Date.now();
    const result = finalizeUnderstandingResult({
      intent,
      taskAnalysis,
      evidence,
    });
    this.log.stage({
      module: "request-understanding",
      stage: REQUEST_UNDERSTANDING_STAGES.finalizeResult,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [REQUEST_UNDERSTANDING_REASON.complete],
    });

    return result;
  }

  /**
   * Step 2a ballot from SituationPack. LLM when `complete` provided;
   * deterministic fallback otherwise. Does not compile route/grant.
   */
  public async assessDirection(
    input: DirectionAnalysisInput,
    complete?: DirectionLlmComplete,
  ): Promise<TaskDirectionAssessment> {
    const startedMs = Date.now();
    const assessment = await assessDirectionWithLlm(input, complete);
    this.log.stage({
      module: "request-understanding",
      stage: "assess-direction",
      durationMs: Date.now() - startedMs,
      reasonCodes: assessment.reasonCodes,
      outputSummary: {
        primaryTaskIntent: assessment.primaryTaskIntent,
        planningHint: assessment.planningHint,
        askUserSuggested: assessment.askUserSuggested,
      },
    });
    return assessment;
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
      projectFingerprint:
        asOptions.projectFingerprint ?? maybeOptions?.projectFingerprint,
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
