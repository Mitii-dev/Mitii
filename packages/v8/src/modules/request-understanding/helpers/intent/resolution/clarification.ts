import { INTENT_CATALOG } from "../catalog";
import type {
  AmbiguousSlot,
  AmbiguousSlotKind,
  IntentClassification,
} from "../schema";
import type {
  SuperIntentClarification,
  SuperIntentOptions,
  TaskIntent,
} from "../types";
import { findIntentScore } from "./scoring";

const SLOT_KIND_PRIORITY: AmbiguousSlotKind[] = [
  "interaction",
  "target",
  "scope",
  "outcome",
  "intent",
];

function pickPreferredAmbiguousSlot(
  slots: readonly AmbiguousSlot[],
): AmbiguousSlot | undefined {
  if (slots.length === 0) return undefined;
  for (const kind of SLOT_KIND_PRIORITY) {
    const match = slots.find(
      (slot) => slot.kind === kind && slot.options.length >= 2,
    );
    if (match) return match;
  }
  return slots.find((slot) => slot.options.length >= 2) ?? slots[0];
}

function humanizeIntent(intent: string): string {
  return intent
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function resolveSecondaryIntents({
  primaryIntent,
  ruleClassification,
  llmClassification,
  options,
}: {
  primaryIntent: TaskIntent;
  ruleClassification?: IntentClassification;
  llmClassification: IntentClassification;
  options: SuperIntentOptions;
}): TaskIntent[] {
  const secondaryIntents = new Set<TaskIntent>();

  for (const intent of llmClassification.secondaryTaskIntents) {
    if (intent !== primaryIntent) {
      secondaryIntents.add(intent);
    }
  }

  for (const intent of ruleClassification?.secondaryTaskIntents ?? []) {
    if (intent !== primaryIntent) {
      secondaryIntents.add(intent);
    }
  }

  return [...secondaryIntents].slice(0, options.maximumSecondaryIntents);
}

export function evaluateClarificationRecommendation({
  primaryConfidence,
  confidenceMargin,
  interactionConflict,
  ruleClassification,
  llmClassification,
  options,
}: {
  primaryConfidence: number;
  confidenceMargin: number;
  interactionConflict: boolean;
  ruleClassification?: IntentClassification;
  llmClassification: IntentClassification;
  options: SuperIntentOptions;
}): boolean {
  if (
    ruleClassification?.needsClarification ||
    llmClassification.needsClarification
  ) {
    return true;
  }

  if (interactionConflict) {
    return true;
  }

  if (primaryConfidence < options.minimumConfidence) {
    return true;
  }

  return confidenceMargin < options.minimumMargin;
}

export function buildResolutionReason({
  primaryIntent,
  primaryConfidence,
  taskAgreement,
  interactionConflict,
  recommendsClarification,
}: {
  primaryIntent: TaskIntent;
  primaryConfidence: number;
  taskAgreement: boolean;
  interactionConflict: boolean;
  recommendsClarification: boolean;
}): string {
  if (interactionConflict) {
    return (
      "Rule and LLM classifiers disagree about whether the request " +
      "permits changes."
    );
  }

  if (recommendsClarification) {
    return (
      `The combined classification favors ${primaryIntent} ` +
      `with confidence ${primaryConfidence.toFixed(2)}, but the ` +
      "result does not meet the acceptance policy."
    );
  }

  if (taskAgreement) {
    return (
      `Rule and LLM classifiers agree on ${primaryIntent} ` +
      `with combined confidence ${primaryConfidence.toFixed(2)}.`
    );
  }

  return (
    `The combined evidence favors ${primaryIntent} ` +
    `with confidence ${primaryConfidence.toFixed(2)}.`
  );
}

export function buildClarification(
  classification: IntentClassification,
  options: SuperIntentOptions,
): SuperIntentClarification {
  const slots = classification.taskHints?.ambiguousSlots ?? [];
  const preferredSlot = pickPreferredAmbiguousSlot(slots);
  if (preferredSlot) {
    return {
      question: preferredSlot.question,
      slotKind: preferredSlot.kind,
      options: preferredSlot.options.map((option) => ({
        id: option.id,
        label: option.label,
        // Never emit "" — AgentRunResult rejects empty description strings.
        description: option.description?.trim() || option.label,
        confidence: 0,
      })),
    };
  }

  const candidateIntents = new Set<TaskIntent>([
    classification.primaryTaskIntent,
    ...classification.alternatives.map((alternative) => alternative.intent),
  ]);

  const clarificationOptions = [...candidateIntents]
    .slice(0, options.maximumClarificationOptions)
    .map((intent) => ({
      id: `intent:${intent}`,
      intent,
      label: humanizeIntent(intent),
      description: INTENT_CATALOG[intent].description,
      confidence: findIntentScore(classification, intent),
    }));

  const hintedQuestion = classification.taskHints?.ambiguityQuestion?.trim();

  return {
    question:
      hintedQuestion && hintedQuestion.length > 0
        ? hintedQuestion
        : "What outcome do you want from this request?",
    slotKind: "intent",
    options: clarificationOptions,
  };
}
