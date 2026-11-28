import {
  TaskClarityAnalyzer,
  TaskComplexityAnalyzer,
  TaskConstraintExtractor,
  TaskOutcomeExtractor,
  TaskRiskAnalyzer,
  TaskScopeAnalyzer,
  TaskTargetExtractor,
  resolveFuzzyFileTargets,
} from "../../analyzer";
import { TASK_ANALYZER_CONSTANTS } from "../../constants";
import { isContinuationTurnKind } from "../../../../rules/TurnKindIntentPolicy";
import type {
  TaskAnalysis,
  TaskAnalysisSignal,
  TaskAnalyzerInput,
} from "../../contracts";
import {
  calculateOverallConfidence,
  clamp,
  estimateFilesAffected,
  isIntentIncluded,
  mergeClarity,
  mergeTargets,
  mergeUniqueStrings,
  normalizeComplexitySignalScore,
  normalizeRiskSignalScore,
  recommendsRepositoryDiscovery as computeRepositoryDiscoveryRecommendation,
  resolveTaskSizeAndPlanningHint,
} from "./rulewiseTaskAnalyzerHelpers";

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
    const mergedTargets = mergeTargets(
      targetResult.targets,
      taskHints?.targets,
      allSignals,
      input.candidateRelativePaths ?? [],
    );
    const fuzzy = resolveFuzzyFileTargets(
      mergedTargets,
      input.candidateRelativePaths ?? [],
    );
    const targets = fuzzy.targets;
    for (const pair of fuzzy.resolved) {
      allSignals.push({
        type: "scope",
        value: `fuzzy_file:${pair.from}->${pair.to}`,
        weight: 0.85,
        evidence: `Resolved file target "${pair.from}" to repo path "${pair.to}".`,
      });
    }

    allSignals.push(...targetResult.signals);

    /*
     * 2. Extract constraints / outcomes (union; deterministic values first)
     */
    const constraintResult = this.constraintExtractor.extract(text);
    const constraints = mergeUniqueStrings(
      constraintResult.values,
      taskHints?.constraints,
    );

    allSignals.push(...constraintResult.signals);

    const outcomeResult = this.outcomeExtractor.extract(text);
    const requestedOutcomes = mergeUniqueStrings(
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
          weight: clamp(signal.confidence),
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
          weight: normalizeComplexitySignalScore(signal.score),
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
          weight: normalizeRiskSignalScore(signal.score),
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

      continuationTurn: isContinuationTurnKind(input.turnKind),
    });
    const clarity = mergeClarity(
      clarityResult.clarity,
      taskHints?.clarity,
    );

    allSignals.push(
      ...clarityResult.signals.map(
        (signal): TaskAnalysisSignal => ({
          type: "clarity",
          value: signal.clarity,
          weight: clamp(signal.confidence),
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

    const recommendsRepositoryDiscovery = computeRepositoryDiscoveryRecommendation(
      primaryTaskIntent,
      targets.length,
      scopeResult.scope,
      targets,
    );

    const recommendsVerification =
      isActionable &&
      isIntentIncluded(
        primaryTaskIntent,
        TASK_ANALYZER_CONSTANTS.INTENT_DEFAULTS.VERIFICATION_REQUIRED,
      );

    const recommendsPlanning =
      interactionIntent === "plan" ||
      (isActionable &&
        (isIntentIncluded(
          primaryTaskIntent,
          TASK_ANALYZER_CONSTANTS.INTENT_DEFAULTS.PLANNING_RECOMMENDED,
        ) ||
          complexityResult.complexity === "complex" ||
          complexityResult.complexity === "very_complex"));

    const { taskSize, planningHint } = resolveTaskSizeAndPlanningHint({
      officerTaskSize: taskHints?.taskSize,
      officerPlanningHint: taskHints?.planningHint,
      sizeDraft: input.sizeDraft?.taskSize,
      complexity: complexityResult.complexity,
      interactionIntent,
      recommendsPlanning,
    });

    const recommendsPlanningNormalized =
      recommendsPlanning || planningHint !== "none";

    const recommendsTaskClarification =
      input.intent.recommendsClarification ||
      (isActionable && clarity === "unclear");

    /*
     * 8. Calculate overall task-analysis confidence
     */
    const overallConfidence = calculateOverallConfidence({
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
      recommendsPlanning: recommendsPlanningNormalized,
      recommendsVerification,
      recommendsTaskClarification,
      taskSize,
      planningHint,

      estimatedFilesAffected: estimateFilesAffected(
        scopeResult.scope,
        complexityResult.complexity,
      ),

      signals: allSignals,
      confidence: overallConfidence,
    };
  }
}
