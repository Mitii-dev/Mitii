import {
  TaskClarityAnalyzer,
  TaskComplexityAnalyzer,
  TaskConstraintExtractor,
  TaskOutcomeExtractor,
  TaskRiskAnalyzer,
  TaskScopeAnalyzer,
  TaskTargetExtractor,
} from "../../analyzer";
import { TASK_ANALYZER_CONSTANTS } from "../../constants";
import type {
  TaskAnalysis,
  TaskAnalysisSignal,
  TaskAnalyzerInput,
  TaskComplexity,
  TaskScope,
} from "../../types";

export class RulewiseTaskAnalyzer {
  private readonly targetExtractor: TaskTargetExtractor;
  private readonly constraintExtractor: TaskConstraintExtractor;
  private readonly scopeAnalyzer: TaskScopeAnalyzer;
  private readonly complexityAnalyzer: TaskComplexityAnalyzer;
  private readonly riskAnalyzer: TaskRiskAnalyzer;
  private readonly clarityAnalyzer: TaskClarityAnalyzer;
  private readonly outcomeExtractor: TaskOutcomeExtractor;

  constructor() {
    this.targetExtractor = new TaskTargetExtractor();
    this.constraintExtractor = new TaskConstraintExtractor();
    this.scopeAnalyzer = new TaskScopeAnalyzer();
    this.complexityAnalyzer = new TaskComplexityAnalyzer();
    this.riskAnalyzer = new TaskRiskAnalyzer();
    this.clarityAnalyzer = new TaskClarityAnalyzer();
    this.outcomeExtractor = new TaskOutcomeExtractor();
  }

  /**
   * Deterministically analyzes task shape after intent classification.
   *
   * This analyzer does not:
   * - classify intent
   * - inspect repository contents
   * - create an execution plan
   * - make execution-policy decisions
   */
  public analyze(input: TaskAnalyzerInput): TaskAnalysis {
    const text = input.userMessage.trim();
    const allSignals: TaskAnalysisSignal[] = [];

    const classification = input.intent.classification;
    const interactionIntent = classification.interactionIntent;
    const primaryTaskIntent = classification.primaryTaskIntent;

    /*
     * 1. Extract targets
     */
    const targetResult = this.targetExtractor.extractWithSignals(
      text,
      input.referencedArtifacts ?? [],
    );

    allSignals.push(...targetResult.signals);

    /*
     * 2. Extract constraints
     */
    const constraintResult = this.constraintExtractor.extract(text);

    allSignals.push(...constraintResult.signals);

    const outcomeResult = this.outcomeExtractor.extract(text);

    allSignals.push(...outcomeResult.signals);

    /*
     * 3. Analyze scope
     */
    const scopeResult = this.scopeAnalyzer.analyzeScope({
      userMessage: text,
      targets: targetResult.targets,
    });

    allSignals.push(
      ...scopeResult.signals.map(
        (signal): TaskAnalysisSignal => ({
          type: "scope",
          value: signal.scope,
          weight: this.clamp(signal.confidence),
          evidence: signal.evidence,
        }),
      ),
    );

    /*
     * 4. Analyze complexity
     */
    const complexityResult =
      this.complexityAnalyzer.analyzeComplexityByText(text);

    allSignals.push(
      ...complexityResult.signals.map(
        (signal): TaskAnalysisSignal => ({
          type: "complexity",
          value: signal.name,
          weight: this.normalizeComplexitySignalScore(signal.score),
          evidence: signal.evidence,
        }),
      ),
    );

    /*
     * 5. Analyze risk
     */
    const riskResult = this.riskAnalyzer.analyze({
      userMessage: text,
      interactionIntent,
      primaryTaskIntent,
      scope: scopeResult.scope,
      constraints: constraintResult.constraints,
    });

    allSignals.push(
      ...riskResult.signals.map(
        (signal): TaskAnalysisSignal => ({
          type: "risk",
          value: signal.name,
          weight: this.normalizeRiskSignalScore(signal.score),
          evidence: signal.evidence,
        }),
      ),
    );

    /*
     * 6. Analyze clarity
     */
    const clarityResult = this.clarityAnalyzer.analyzeClarity({
      userMessage: text,
      targets: targetResult.targets,

      intentRequiresClarification: input.intent.requiresClarification,

      intentConfidence: classification.confidence,

      confidenceMargin: input.intent.confidenceMargin,
    });

    allSignals.push(
      ...clarityResult.signals.map(
        (signal): TaskAnalysisSignal => ({
          type: "clarity",
          value: signal.clarity,
          weight: this.clamp(signal.confidence),
          evidence: signal.evidence,
        }),
      ),
    );

    /*
     * 7. Determine downstream recommendations
     */
    const isActionable = interactionIntent === "act";

    const requiresRepositoryDiscovery = this.requiresRepositoryDiscovery(
      primaryTaskIntent,
      targetResult.targets.length,
      scopeResult.scope,
    );

    const requiresVerification =
      isActionable &&
      this.isIntentIncluded(
        primaryTaskIntent,
        TASK_ANALYZER_CONSTANTS.INTENT_DEFAULTS.VERIFICATION_REQUIRED,
      );

    const requiresPlanning =
      interactionIntent === "plan" ||
      (isActionable &&
        (this.isIntentIncluded(
          primaryTaskIntent,
          TASK_ANALYZER_CONSTANTS.INTENT_DEFAULTS.PLANNING_RECOMMENDED,
        ) ||
          complexityResult.complexity === "complex" ||
          complexityResult.complexity === "very_complex"));

    const requiresTaskClarification =
      input.intent.requiresClarification ||
      (isActionable && clarityResult.clarity === "unclear");

    /*
     * 8. Calculate overall task-analysis confidence
     */
    const overallConfidence = this.calculateOverallConfidence({
      intentConfidence: classification.confidence,
      constraintConfidence: constraintResult.confidence,
      hasConstraints: constraintResult.constraints.length > 0,
      scopeConfidence: scopeResult.confidence,
      riskConfidence: riskResult.confidence,
      clarityConfidence: clarityResult.confidence,
      complexity: complexityResult.complexity,
      complexitySignalCount: complexityResult.signals.length,
    });

    return {
      scope: scopeResult.scope,
      complexity: complexityResult.complexity,
      risk: riskResult.risk,
      clarity: clarityResult.clarity,
      targets: targetResult.targets,
      constraints: constraintResult.values,
      requestedOutcomes: outcomeResult.values,

      requiresRepositoryDiscovery,
      requiresPlanning,
      requiresVerification,
      requiresTaskClarification,

      estimatedFilesAffected: this.estimateFilesAffected(
        scopeResult.scope,
        complexityResult.complexity,
      ),

      signals: allSignals,
      confidence: overallConfidence,
    };
  }

  private requiresRepositoryDiscovery(
    primaryTaskIntent: TaskAnalyzerInput["intent"]["classification"]["primaryTaskIntent"],
    targetCount: number,
    scope: TaskScope,
  ): boolean {
    if (targetCount > 0) {
      return false;
    }

    if (
      scope === "repository" ||
      scope === "workspace" ||
      scope === "package"
    ) {
      return true;
    }

    return this.isIntentIncluded(
      primaryTaskIntent,
      TASK_ANALYZER_CONSTANTS.INTENT_DEFAULTS.REPOSITORY_DEPENDENT,
    );
  }

  private isIntentIncluded(
    intent: TaskAnalyzerInput["intent"]["classification"]["primaryTaskIntent"],
    intents: readonly string[],
  ): boolean {
    return intents.includes(intent);
  }

  private calculateOverallConfidence(input: {
    intentConfidence: number;
    constraintConfidence: number;
    hasConstraints: boolean;
    scopeConfidence: number;
    riskConfidence: number;
    clarityConfidence: number;
    complexity: TaskComplexity;
    complexitySignalCount: number;
  }): number {
    const confidenceValues = [
      this.clamp(input.intentConfidence),
      this.clamp(input.scopeConfidence),
      this.clamp(input.riskConfidence),
      this.clamp(input.clarityConfidence),
      this.estimateComplexityConfidence(
        input.complexity,
        input.complexitySignalCount,
      ),
    ];

    /*
     * Absence of constraints is not uncertainty.
     * Include constraint confidence only when constraints were found.
     */
    if (input.hasConstraints) {
      confidenceValues.push(this.clamp(input.constraintConfidence));
    }

    const total = confidenceValues.reduce(
      (sum, confidence) => sum + confidence,
      0,
    );

    return this.clamp(total / confidenceValues.length);
  }

  private estimateComplexityConfidence(
    complexity: TaskComplexity,
    signalCount: number,
  ): number {
    if (signalCount === 0) {
      return complexity === "simple" || complexity === "trivial" ? 0.65 : 0.55;
    }

    return this.clamp(0.65 + Math.min(0.25, signalCount * 0.04));
  }

  private normalizeComplexitySignalScore(score: number): number {
    /*
     * Complexity scores can be larger than 1.
     * TaskAnalysisSignal.weight must remain between 0 and 1.
     */
    return this.clamp(Math.abs(score) / 3);
  }

  private normalizeRiskSignalScore(score: number): number {
    /*
     * Risk scores can be positive or negative.
     * Weight represents evidence strength, not direction.
     */
    return this.clamp(Math.abs(score) / 7);
  }

  private estimateFilesAffected(
    scope: TaskScope,
    complexity: TaskComplexity,
  ): {
    minimum: number;
    maximum?: number;
  } {
    switch (scope) {
      case "single_location":
        return {
          minimum: 1,
          maximum:
            complexity === "complex" || complexity === "very_complex" ? 3 : 1,
        };

      case "multi_file":
        return {
          minimum: 2,
          maximum:
            complexity === "very_complex"
              ? 15
              : complexity === "complex"
                ? 10
                : 6,
        };

      case "package":
        return {
          minimum: 3,
          maximum: complexity === "very_complex" ? 25 : 15,
        };

      case "repository":
        return {
          minimum: 5,
          maximum: complexity === "very_complex" ? 50 : 30,
        };

      case "workspace":
        return {
          minimum: 5,
        };

      case "unknown":
      default:
        return {
          minimum: 1,
        };
    }
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
