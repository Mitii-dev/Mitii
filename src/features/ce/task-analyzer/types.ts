import type {
  InteractionIntent,
  SuperIntentResult,
  TaskIntent,
} from '../intent';

/**
 * REFERENCED ARTIFACTS
 */
export type ReferencedArtifactKind =
  | 'file'
  | 'folder'
  | 'attachment'
  | 'selection';

export interface ReferencedArtifact {
  name: string;
  path?: string;
  kind: ReferencedArtifactKind;
  extension?: string;
  language?: string;
}

/**
 * MAIN TASK ANALYZER
 */

export interface TaskAnalyzerInput {
  userMessage: string;
  intent: SuperIntentResult;
  referencedArtifacts?: readonly ReferencedArtifact[];
}

export type TaskScope =
  | 'single_location'
  | 'multi_file'
  | 'package'
  | 'repository'
  | 'workspace'
  | 'unknown';

export type TaskComplexity =
  | 'trivial'
  | 'simple'
  | 'moderate'
  | 'complex'
  | 'very_complex';

export type TaskRisk =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export type TaskClarity =
  | 'clear'
  | 'partially_clear'
  | 'unclear';

export interface TaskTarget {
  kind:
    | 'file'
    | 'folder'
    | 'symbol'
    | 'package'
    | 'repository'
    | 'workspace'
    | 'unknown';

  value: string;

  /**
   * True when the target was directly mentioned in the user message.
   * False when it came from IDE context or referenced artifacts.
   */
  explicit: boolean;
}

export type TaskAnalysisSignalType =
  | 'scope'
  | 'complexity'
  | 'risk'
  | 'clarity'
  | 'constraint'
  | 'verification';

export interface TaskAnalysisSignal {
  type: TaskAnalysisSignalType;
  value: string;
  weight: number;
  evidence: string;
}

export interface EstimatedFileImpact {
  minimum: number;
  maximum?: number;
}

export interface TaskAnalysis {
  scope: TaskScope;
  complexity: TaskComplexity;
  risk: TaskRisk;
  clarity: TaskClarity;

  targets: TaskTarget[];

  /**
   * Flattened constraint values for downstream consumers.
   */
  constraints: string[];

  requestedOutcomes: string[];

  requiresRepositoryDiscovery: boolean;

  /**
   * These are recommendations.
   * Downstream execution policy makes the final decision.
   */
  requiresPlanning: boolean;
  requiresVerification: boolean;

  requiresTaskClarification: boolean;

  estimatedFilesAffected?: EstimatedFileImpact;

  signals: TaskAnalysisSignal[];
  confidence: number;
}

/**
 * TASK COMPLEXITY ANALYSIS
 */

export interface TaskComplexitySignal {
  name: string;
  score: number;
  evidence: string;
}

export interface TaskComplexityDetails {
  complexity: TaskComplexity;
  score: number;
  signals: TaskComplexitySignal[];
}

/**
 * TASK CLARITY ANALYSIS
 */

export interface TaskClaritySignal {
  clarity: TaskClarity;
  confidence: number;
  evidence: string;
}

export interface TaskClarityAnalysis {
  clarity: TaskClarity;

  /**
   * Confidence in the clarity assessment,
   * not the intent classification confidence.
   */
  confidence: number;

  signals: TaskClaritySignal[];
}

export interface TaskClarityAnalyzerInput {
  userMessage: string;
  targets: readonly TaskTarget[];

  intentConfidence: number;
  confidenceMargin: number;
  intentRequiresClarification: boolean;
}

/**
 * TASK SCOPE ANALYSIS
 */

export interface TaskScopeSignal {
  scope: TaskScope;
  confidence: number;
  evidence: string;
}

export interface TaskScopeAnalysis {
  scope: TaskScope;
  confidence: number;
  signals: TaskScopeSignal[];
}

export interface TaskScopeAnalyzerInput {
  userMessage: string;
  targets: readonly TaskTarget[];
}

/**
 * TASK CONSTRAINT EXTRACTION
 */

export type TaskConstraintKind =
  | 'prohibition'
  | 'restriction'
  | 'requirement'
  | 'preservation'
  | 'technology'
  | 'scope'
  | 'verification'
  | 'unknown';

export interface TaskConstraint {
  kind: TaskConstraintKind;

  /**
   * Normalized constraint value.
   *
   * Example:
   * "modify files outside src/auth"
   */
  value: string;

  /**
   * Original matching text from the user message.
   */
  sourceText: string;

  confidence: number;
}

export interface TaskConstraintExtraction {
  constraints: TaskConstraint[];

  /**
   * Flattened values for the main TaskAnalysis result.
   */
  values: string[];

  signals: TaskAnalysisSignal[];
  confidence: number;
}

/**
 * TASK RISK ANALYSIS
 */

export interface TaskRiskSignal {
  name: string;

  /**
   * Positive values increase risk.
   * Negative values reduce risk.
   */
  score: number;

  evidence: string;
}

export interface TaskRiskAnalysis {
  risk: TaskRisk;
  score: number;

  /**
   * Confidence in the risk assessment,
   * not intent confidence.
   */
  confidence: number;

  signals: TaskRiskSignal[];
}

export interface TaskRiskAnalyzerInput {
  userMessage: string;
  interactionIntent: InteractionIntent;
  primaryTaskIntent: TaskIntent;
  scope: TaskScope;

  /**
   * Structured constraints returned by TaskConstraintExtractor.
   */
  constraints?: readonly TaskConstraint[];
}