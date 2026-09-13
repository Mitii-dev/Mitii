import type {
  InteractionIntent,
  IntentClassification,
} from "./schema";
import type { TaskIntent } from "./types";

/**
 * Structured fact patch derived from a clarification option id.
 * Applied on resume before re-running understand/decide.
 */
export interface ClarificationFactPatch {
  optionId: string;
  label?: string;
  interactionIntent?: InteractionIntent;
  primaryTaskIntent?: TaskIntent;
  targetPath?: string;
  scopeHint?: "one_file" | "module" | "repo";
  outcomeNote?: string;
}

const TASK_INTENTS = [
  "bugfix",
  "feature",
  "refactor",
  "optimize",
  "diagnose",
  "test",
  "audit",
  "review",
  "security",
  "trace",
  "scaffold",
  "migrate",
  "schema",
  "mock",
  "config",
  "dependency",
  "docs",
  "style",
  "format",
  "question",
] as const;

const TASK_INTENT_SET = new Set<string>(TASK_INTENTS);
const INTERACTION_SET = new Set<string>([
  "question",
  "plan",
  "act",
  "help",
  "unknown",
]);

/**
 * Parse a namespaced clarification option id into a fact patch.
 */
export function parseClarificationOptionId(
  optionId: string,
  label?: string,
): ClarificationFactPatch {
  const trimmed = optionId.trim();
  const patch: ClarificationFactPatch = { optionId: trimmed, label };

  const colon = trimmed.indexOf(":");
  if (colon <= 0) {
    // Legacy: bare task intent id
    if (TASK_INTENT_SET.has(trimmed)) {
      patch.primaryTaskIntent = trimmed as TaskIntent;
    }
    return patch;
  }

  const kind = trimmed.slice(0, colon).toLowerCase();
  const value = trimmed.slice(colon + 1).trim();
  if (!value) return patch;

  switch (kind) {
    case "intent":
      if (TASK_INTENT_SET.has(value)) {
        patch.primaryTaskIntent = value as TaskIntent;
      }
      break;
    case "interaction":
      if (INTERACTION_SET.has(value)) {
        patch.interactionIntent = value as InteractionIntent;
      }
      break;
    case "target":
      patch.targetPath = value.replace(/\\/g, "/").replace(/^\.\//, "");
      break;
    case "scope":
      if (value === "one_file" || value === "module" || value === "repo") {
        patch.scopeHint = value;
      }
      break;
    case "outcome":
      patch.outcomeNote = label?.trim() || value.replace(/[_-]+/g, " ");
      break;
    default:
      break;
  }

  return patch;
}

/**
 * Apply a clarification fact patch onto a classification (overlay, not widen grants).
 */
export function applyClarificationFactPatch(
  classification: IntentClassification,
  patch: ClarificationFactPatch,
): IntentClassification {
  const next: IntentClassification = {
    ...classification,
    secondaryTaskIntents: [...classification.secondaryTaskIntents],
    alternatives: classification.alternatives.map((alt) => ({ ...alt })),
    taskHints: classification.taskHints
      ? {
          ...classification.taskHints,
          targets: [...(classification.taskHints.targets ?? [])],
          constraints: [...(classification.taskHints.constraints ?? [])],
          requestedOutcomes: [
            ...(classification.taskHints.requestedOutcomes ?? []),
          ],
          recommendedSkillTags: [
            ...(classification.taskHints.recommendedSkillTags ?? []),
          ],
          ambiguousSlots: [...(classification.taskHints.ambiguousSlots ?? [])],
        }
      : undefined,
  };

  if (patch.interactionIntent) {
    next.interactionIntent = patch.interactionIntent;
  }
  if (patch.primaryTaskIntent) {
    next.primaryTaskIntent = patch.primaryTaskIntent;
  }
  next.needsClarification = false;

  if (patch.targetPath) {
    const hints = next.taskHints ?? {
      targets: [],
      constraints: [],
      requestedOutcomes: [],
      recommendedSkillTags: [],
      ambiguousSlots: [],
    };
    const withoutDup = hints.targets.filter(
      (t) => t.value !== patch.targetPath,
    );
    next.taskHints = {
      ...hints,
      targets: [
        { kind: "file" as const, value: patch.targetPath, explicit: true },
        ...withoutDup,
      ].slice(0, 20),
      clarity: "clear",
    };
  }

  if (patch.outcomeNote) {
    const hints = next.taskHints ?? {
      targets: [],
      constraints: [],
      requestedOutcomes: [],
      recommendedSkillTags: [],
      ambiguousSlots: [],
    };
    next.taskHints = {
      ...hints,
      requestedOutcomes: [
        patch.outcomeNote,
        ...hints.requestedOutcomes.filter((o) => o !== patch.outcomeNote),
      ].slice(0, 20),
      clarity: "clear",
    };
  }

  if (patch.scopeHint) {
    const hints = next.taskHints ?? {
      targets: [],
      constraints: [],
      requestedOutcomes: [],
      recommendedSkillTags: [],
      ambiguousSlots: [],
    };
    const scopeConstraint = `scope:${patch.scopeHint}`;
    next.taskHints = {
      ...hints,
      constraints: [
        scopeConstraint,
        ...hints.constraints.filter((c) => c !== scopeConstraint),
      ].slice(0, 20),
    };
  }

  return next;
}

/**
 * Human-readable clarification line for message continuity.
 */
export function formatClarificationAnswerFromPatch(
  patch: ClarificationFactPatch,
): string {
  if (patch.label && patch.label.trim()) {
    return patch.label.trim();
  }
  if (patch.targetPath) {
    return `Use target ${patch.targetPath}`;
  }
  if (patch.interactionIntent) {
    return `Treat as ${patch.interactionIntent}`;
  }
  if (patch.primaryTaskIntent) {
    return `Proceed as ${patch.primaryTaskIntent}`;
  }
  if (patch.outcomeNote) {
    return patch.outcomeNote;
  }
  if (patch.scopeHint) {
    return `Scope: ${patch.scopeHint}`;
  }
  return patch.optionId;
}
