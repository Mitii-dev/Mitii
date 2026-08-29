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
  TaskClarity,
  TaskComplexity,
  TaskScope,
  TaskTarget,
} from "../../contracts";

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

    const taskHints = classification.taskHints;

    /*
     * 1. Extract targets (deterministic first; LLM hints fill gaps only)
     */
    const targetResult = this.targetExtractor.extractWithSignals(
      text,
      input.referencedArtifacts ?? [],
    );
    const targets = this.mergeTargets(
      targetResult.targets,
      taskHints?.targets,
      allSignals,
    );

    allSignals.push(...targetResult.signals);

    /*
     * 2. Extract constraints / outcomes (union; deterministic values first)
     */
    const constraintResult = this.constraintExtractor.extract(text);
    const constraints = this.mergeUniqueStrings(
      constraintResult.values,
      taskHints?.constraints,
    );

    allSignals.push(...constraintResult.signals);

    const outcomeResult = this.outcomeExtractor.extract(text);
    const requestedOutcomes = this.mergeUniqueStrings(
      outcomeResult.values,
      taskHints?.requestedOutcomes,
    );

    allSignals.push(...outcomeResult.signals);

    /*
     * 3. Analyze scope
     */
    const scopeResult = this.scopeAnalyzer.analyzeScope({
      userMessage: text,
      targets,
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
      // Risk scoring uses structured deterministic constraints only.
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
      targets,

      intentRequiresClarification: input.intent.recommendsClarification,

      intentConfidence: classification.confidence,

      confidenceMargin: input.intent.confidenceMargin,
    });
    const clarity = this.mergeClarity(
      clarityResult.clarity,
      taskHints?.clarity,
    );

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
    if (clarity !== clarityResult.clarity && taskHints?.clarity) {
      allSignals.push({
        type: "clarity",
        value: clarity,
        weight: 0.55,
        evidence: `Merged LLM clarity hint (${taskHints.clarity}) with deterministic clarity (${clarityResult.clarity}).`,
      });
    }

    /*
     * 7. Determine downstream recommendations (evidence only — Decision Policy authorizes)
     */
    const isActionable = interactionIntent === "act";

    const recommendsRepositoryDiscovery = this.recommendsRepositoryDiscovery(
      primaryTaskIntent,
      targets.length,
      scopeResult.scope,
      targets,
    );

    const recommendsVerification =
      isActionable &&
      this.isIntentIncluded(
        primaryTaskIntent,
        TASK_ANALYZER_CONSTANTS.INTENT_DEFAULTS.VERIFICATION_REQUIRED,
      );

    const recommendsPlanning =
      interactionIntent === "plan" ||
      (isActionable &&
        (this.isIntentIncluded(
          primaryTaskIntent,
          TASK_ANALYZER_CONSTANTS.INTENT_DEFAULTS.PLANNING_RECOMMENDED,
        ) ||
          complexityResult.complexity === "complex" ||
          complexityResult.complexity === "very_complex"));

    const recommendsTaskClarification =
      input.intent.recommendsClarification ||
      (isActionable && clarity === "unclear");

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
      clarity,
      targets,
      constraints,
      requestedOutcomes,

      recommendsRepositoryDiscovery,
      recommendsPlanning,
      recommendsVerification,
      recommendsTaskClarification,

      estimatedFilesAffected: this.estimateFilesAffected(
        scopeResult.scope,
        complexityResult.complexity,
      ),

      signals: allSignals,
      confidence: overallConfidence,
    };
  }

  /**
   * Deterministic targets win on duplicates; LLM hints only add missing ones.
   */
  private mergeTargets(
    deterministic: readonly TaskTarget[],
    hinted: readonly TaskTarget[] | undefined,
    signals: TaskAnalysisSignal[],
  ): TaskTarget[] {
    const merged = [...deterministic];
    const seen = new Set(
      deterministic.map((target) => this.targetKey(target)),
    );

    for (const hint of hinted ?? []) {
      const value = hint.value.trim();
      if (!value) {
        continue;
      }
      const candidate: TaskTarget = {
        kind: hint.kind,
        value,
        explicit: hint.explicit,
      };
      const key = this.targetKey(candidate);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(candidate);
      signals.push({
        type: "scope",
        value: `${candidate.kind}:${candidate.value}`,
        weight: 0.5,
        evidence: `LLM task hint added ${candidate.kind} target: ${candidate.value}`,
      });
    }

    return merged;
  }

  private mergeUniqueStrings(
    deterministic: readonly string[],
    hinted: readonly string[] | undefined,
  ): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();

    for (const value of [...deterministic, ...(hinted ?? [])]) {
      const normalized = value.trim();
      if (!normalized) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(normalized);
    }

    return merged;
  }

  /** Prefer the more conservative (less clear) rating when both are present. */
  private mergeClarity(
    deterministic: TaskClarity,
    hinted: TaskClarity | undefined,
  ): TaskClarity {
    if (!hinted) {
      return deterministic;
    }
    const rank: Record<TaskClarity, number> = {
      clear: 0,
      partially_clear: 1,
      unclear: 2,
    };
    return rank[hinted] > rank[deterministic] ? hinted : deterministic;
  }

  private targetKey(target: TaskTarget): string {
    return `${target.kind}:${target.value.trim().toLowerCase()}`;
  }

  private recommendsRepositoryDiscovery(
    primaryTaskIntent: TaskAnalyzerInput["intent"]["classification"]["primaryTaskIntent"],
    targetCount: number,
    scope: TaskScope,
    targets: ReadonlyArray<{ kind: string }>,
  ): boolean {
    if (
      scope === "repository" ||
      scope === "workspace" ||
      scope === "package" ||
      scope === "multi_file"
    ) {
      return true;
    }

    // Scope-level targets still need repository grounding.
    if (
      targets.some(
        (target) =>
          target.kind === "repository" ||
          target.kind === "workspace" ||
          target.kind === "package",
      )
    ) {
      return true;
    }

    // Concrete file/folder/symbol targets are routed via explicit targets
    // in Decision Policy; do not double-flag discovery.
    if (targetCount > 0) {
      return false;
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
    const thresholds = TASK_ANALYZER_CONSTANTS.THRESHOLDS.COMPLEXITY_CONFIDENCE;

    if (signalCount === 0) {
      return complexity === "simple" || complexity === "trivial"
        ? thresholds.EMPTY_SIMPLE
        : thresholds.EMPTY_OTHER;
    }

    return this.clamp(
      thresholds.BASE +
        Math.min(thresholds.MAX_BONUS, signalCount * thresholds.PER_SIGNAL),
    );
  }

  private normalizeComplexitySignalScore(score: number): number {
    return this.clamp(
      Math.abs(score) /
        TASK_ANALYZER_CONSTANTS.THRESHOLDS.SIGNAL_NORMALIZATION
          .COMPLEXITY_DIVISOR,
    );
  }

  private normalizeRiskSignalScore(score: number): number {
    return this.clamp(
      Math.abs(score) /
        TASK_ANALYZER_CONSTANTS.THRESHOLDS.SIGNAL_NORMALIZATION.RISK_DIVISOR,
    );
  }

  private estimateFilesAffected(
    scope: TaskScope,
    complexity: TaskComplexity,
  ): {
    minimum: number;
    maximum?: number;
  } {
    const impact = TASK_ANALYZER_CONSTANTS.FILE_IMPACT;

    switch (scope) {
      case "single_location":
        return {
          minimum: impact.single_location.minimum,
          maximum:
            complexity === "complex" || complexity === "very_complex"
              ? impact.single_location.complexMaximum
              : impact.single_location.defaultMaximum,
        };

      case "multi_file":
        return {
          minimum: impact.multi_file.minimum,
          maximum:
            complexity === "very_complex"
              ? impact.multi_file.veryComplexMaximum
              : complexity === "complex"
                ? impact.multi_file.complexMaximum
                : impact.multi_file.defaultMaximum,
        };

      case "package":
        return {
          minimum: impact.package.minimum,
          maximum:
            complexity === "very_complex"
              ? impact.package.veryComplexMaximum
              : impact.package.defaultMaximum,
        };

      case "repository":
        return {
          minimum: impact.repository.minimum,
          maximum:
            complexity === "very_complex"
              ? impact.repository.veryComplexMaximum
              : impact.repository.defaultMaximum,
        };

      case "workspace":
        return {
          minimum: impact.workspace.minimum,
        };

      case "unknown":
      default:
        return {
          minimum: impact.unknown.minimum,
        };
    }
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
