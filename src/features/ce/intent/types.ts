import { LlmIntentClassifier, RuleIntentClassifier } from "./classifiers";
import { INTENT_CONSTANTS } from "./constants";
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
  | "file"
  | "folder"
  | "attachment"
  | "selection";

export interface IntentClassificationInput {
  userMessage: string;
  referencedArtifacts?: readonly ReferencedArtifact[];
}

export interface IntentRouterDependencies {
  ruleClassifier?: RuleIntentClassifier;
  llmClassifier?: LlmIntentClassifier;
}

export interface ReferencedArtifact {
  /**
   * Display name of the file, folder, attachment, or selection.
   *
   * Examples:
   * - session.jsonl
   * - src/auth
   * - login.ts
   */
  name: string;

  /**
   * Optional repository-relative or workspace-relative path.
   *
   * Do not read the path inside the intent classifier.
   */
  path?: string;

  kind: ReferencedArtifactKind;

  /**
   * Optional extension including the period.
   *
   * Examples:
   * - .ts
   * - .jsonl
   * - .md
   */
  extension?: string;

  /**
   * Optional language associated with a selected code block or file.
   *
   * Examples:
   * - typescript
   * - python
   * - json
   */
  language?: string;
}
