import type {
  AgentMode,
} from "../../request-intake";

import type {
  RequestArtifactKind,
  RequestArtifactReference,
} from "../../request-intake";

import {
  INTENT_CONSTANTS,
} from "./constants";

import type {
  IntentClassification,
  InteractionIntent,
} from "./schema";
export type TaskIntent = (typeof INTENT_CONSTANTS.TASK_INTENTS)[number];

export interface IntentDefinition {
  id: TaskIntent;
  description: string;
  includes: string[];
  excludes: string[];
  confusedWith: TaskIntent[];
  examples: string[];
}

export interface IntentRule {
  intent: TaskIntent;
  pattern: RegExp;
  confidence: number;
}

export type ReferencedArtifactKind =
  RequestArtifactKind;

export interface IntentClassificationInput {
  mode: AgentMode;
  userMessage: string;
  referencedArtifacts?: readonly ReferencedArtifact[];
}

export interface IntentRouterDependencies {
  ruleClassifier?:
    RuleIntentClassifierPort;
  llmClassifier?:
    LlmIntentClassifierPort;
}

export interface RuleIntentClassifierPort {
  classifyMessage(
    message: string,
  ): IntentClassification | null;
}

export interface LlmIntentClassifierPort {
  classify(
    input: IntentClassificationInput,
  ): Promise<IntentClassification>;
}

export type ReferencedArtifact =
  RequestArtifactReference;

export type IntentClassifierSource = "explicit_rule" | "heuristic_rule" | "llm";

export interface IntentClassifierResult {
  source: IntentClassifierSource;
  classification: IntentClassification;
  matchedRule?: string;
}

export type SuperIntentStatus = "accepted" | "clarification_required";

export interface SuperIntentScore {
  intent: TaskIntent;

  /**
   * Final combined score after weighting and adjustments.
   */
  score: number;

  /**
   * Score contributed by the deterministic rule classifier.
   */
  ruleScore: number;

  /**
   * Score contributed by the LLM classifier.
   */
  llmScore: number;
}

export interface SuperIntentClarificationOption {
  intent: TaskIntent;
  label: string;
  description: string;
  confidence: number;
}

export interface SuperIntentClarification {
  question: string;
  options: SuperIntentClarificationOption[];
}

export interface SuperIntentDiagnostics {
  ruleSource?: IntentClassifierSource;
  matchedRule?: string;

  rulePrimaryIntent?: TaskIntent;
  llmPrimaryIntent: TaskIntent;

  ruleInteractionIntent?: InteractionIntent;
  llmInteractionIntent: InteractionIntent;

  taskAgreement: boolean;
  interactionAgreement: boolean;
  interactionConflict: boolean;

  agreementBonusApplied: number;
  disagreementPenaltyApplied: number;

  minimumConfidence: number;
  minimumMargin: number;
}

export interface SuperIntentResult {
  status: SuperIntentStatus;

  /**
   * Final normalized classification.
   */
  classification: IntentClassification;

  /**
   * Scores for all intents that received evidence.
   */
  scores: SuperIntentScore[];

  /**
   * Difference between the primary and best alternative.
   */
  confidenceMargin: number;

  requiresClarification: boolean;
  clarification?: SuperIntentClarification;

  diagnostics: SuperIntentDiagnostics;
}

export interface SuperIntentInput {
  mode: AgentMode;

  /**
   * Rule result can be absent when no deterministic rule matched.
   */
  ruleResult?: IntentClassifierResult | null;

  /**
   * LLM result is required for normal ensemble resolution.
   */
  llmResult: IntentClassifierResult;
}

export interface SuperIntentOptions {
  llmWeight: number;
  heuristicRuleWeight: number;

  agreementBonus: number;
  disagreementPenalty: number;

  minimumConfidence: number;
  minimumMargin: number;

  maximumAlternatives: number;
  maximumSecondaryIntents: number;
  maximumClarificationOptions: number;
}
