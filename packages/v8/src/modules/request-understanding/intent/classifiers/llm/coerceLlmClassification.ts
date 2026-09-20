/**
 * Soft-coerce common LLM shape drift so a near-valid ballot is not discarded.
 * Strict Zod still runs after this — coercion only maps known aliases / shapes.
 *
 * VTCode/Codex-shaped formulae (Mitii-adapted):
 * - Ballot salvage: drop/remap invalid fields; never wipe a valid core ballot.
 * - Alternatives whitelist: alternatives[].intent ∈ TASK_INTENTS only.
 * - Interaction ≠ task: mode verbs never land in task intent slots.
 */

import { INTENT_CONSTANTS } from "../../constants";

const CLARITY_ALIASES: Record<string, "clear" | "partially_clear" | "unclear"> = {
  clear: "clear",
  clear_enough: "clear",
  partially_clear: "partially_clear",
  partial: "partially_clear",
  partially: "partially_clear",
  ambiguous: "unclear",
  unclear: "unclear",
  vague: "unclear",
  unknown: "unclear",
};

const TARGET_KIND_ALIASES: Record<string, string> = {
  file: "file",
  folder: "folder",
  directory: "folder",
  dir: "folder",
  symbol: "symbol",
  package: "package",
  repository: "repository",
  repo: "repository",
  workspace: "workspace",
  page: "unknown",
  component: "unknown",
  module: "unknown",
  unknown: "unknown",
};

const SLOT_KINDS = new Set([
  "interaction",
  "target",
  "scope",
  "outcome",
  "intent",
]);

const TASK_INTENT_SET = new Set<string>(INTENT_CONSTANTS.TASK_INTENTS);

/** Interaction-only verbs that models sometimes put in task slots. */
const INTERACTION_ONLY = new Set([
  "plan",
  "act",
  "help",
  "ask",
  "agent",
  "unknown",
]);

const INTERACTION_INTENTS = new Set([
  "question",
  "plan",
  "act",
  "help",
  "unknown",
]);

/** Map interaction-only labels onto a safe task intent. */
const INTERACTION_TO_TASK: Record<string, string> = {
  plan: "question",
  act: "feature",
  help: "question",
  ask: "question",
  agent: "feature",
  unknown: "question",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function slugifyOption(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "option";
}

function inferSlotKind(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.kind === "string" && SLOT_KINDS.has(raw.kind)) {
    return raw.kind;
  }
  if (typeof raw.id === "string") {
    const prefix = raw.id.split(":")[0]?.trim();
    if (prefix && SLOT_KINDS.has(prefix)) {
      return prefix;
    }
  }
  return undefined;
}

function coerceSlotOptions(
  kind: string,
  options: unknown,
): Array<{ id: string; label: string }> | undefined {
  if (!Array.isArray(options) || options.length < 2) {
    return undefined;
  }

  const coerced: Array<{ id: string; label: string }> = [];
  for (const option of options.slice(0, 6)) {
    if (typeof option === "string") {
      const label = option.trim();
      if (!label) {
        continue;
      }
      coerced.push({
        id: `${kind}:${slugifyOption(label)}`,
        label: label.slice(0, 200),
      });
      continue;
    }
    const record = asRecord(option);
    if (!record) {
      continue;
    }
    const label =
      typeof record.label === "string"
        ? record.label.trim()
        : typeof record.id === "string"
          ? record.id.trim()
          : "";
    if (!label) {
      continue;
    }
    const id =
      typeof record.id === "string" && record.id.trim().length > 0
        ? record.id.trim().slice(0, 200)
        : `${kind}:${slugifyOption(label)}`;
    coerced.push({ id, label: label.slice(0, 200) });
  }

  return coerced.length >= 2 ? coerced : undefined;
}

function coerceAmbiguousSlots(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const slots: unknown[] = [];
  for (const item of raw.slice(0, 4)) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const kind = inferSlotKind(record);
    const question =
      typeof record.question === "string" ? record.question.trim() : "";
    if (!kind || !question) {
      continue;
    }
    const options = coerceSlotOptions(kind, record.options);
    if (!options) {
      continue;
    }
    slots.push({ kind, question: question.slice(0, 500), options });
  }

  return slots;
}

function coerceTargets(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  return raw.slice(0, 20).map((item) => {
    const record = asRecord(item);
    if (!record) {
      return item;
    }
    const kindRaw =
      typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
    const kind = TARGET_KIND_ALIASES[kindRaw] ?? "unknown";
    return {
      ...record,
      kind,
    };
  });
}

function coerceTaskHints(raw: unknown): unknown {
  const hints = asRecord(raw);
  if (!hints) {
    return raw;
  }

  const next: Record<string, unknown> = { ...hints };

  if (typeof hints.clarity === "string") {
    const mapped =
      CLARITY_ALIASES[hints.clarity.trim().toLowerCase().replace(/\s+/g, "_")];
    if (mapped) {
      next.clarity = mapped;
    } else {
      delete next.clarity;
    }
  }

  if ("targets" in hints) {
    next.targets = coerceTargets(hints.targets);
  }

  if ("ambiguousSlots" in hints) {
    const slots = coerceAmbiguousSlots(hints.ambiguousSlots);
    next.ambiguousSlots = slots ?? [];
  }

  return next;
}

function normalizeTaskIntentLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!value) {
    return undefined;
  }
  if (TASK_INTENT_SET.has(value)) {
    return value;
  }
  if (INTERACTION_ONLY.has(value)) {
    return INTERACTION_TO_TASK[value] ?? "question";
  }
  return undefined;
}

function coerceInteractionIntent(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (INTERACTION_INTENTS.has(value)) {
    return value;
  }
  // Task verbs mis-placed on interaction → act (executable) or question.
  if (TASK_INTENT_SET.has(value) && value !== "question") {
    return "act";
  }
  return undefined;
}

function coerceAlternatives(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<{ intent: string; confidence: number }> = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, INTENT_CONSTANTS.MAX_ALTERNATIVES + 2)) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    // Drop interaction-only verbs (plan/act/help) — do not remap into task
    // alternatives (would invent noisy "question" chips).
    if (
      typeof record.intent === "string" &&
      INTERACTION_ONLY.has(record.intent.trim().toLowerCase())
    ) {
      continue;
    }
    const intent = normalizeTaskIntentLabel(record.intent);
    if (!intent || seen.has(intent)) {
      continue;
    }
    const confidence =
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? Math.min(1, Math.max(0, record.confidence))
        : 0;
    seen.add(intent);
    out.push({ intent, confidence });
    if (out.length >= INTENT_CONSTANTS.MAX_ALTERNATIVES) {
      break;
    }
  }
  return out;
}

function coerceSecondaryIntents(raw: unknown, primary?: string): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>(primary ? [primary] : []);
  for (const item of raw.slice(0, INTENT_CONSTANTS.MAX_SECONDARY + 2)) {
    const intent = normalizeTaskIntentLabel(item);
    if (!intent || seen.has(intent)) {
      continue;
    }
    seen.add(intent);
    out.push(intent);
    if (out.length >= INTENT_CONSTANTS.MAX_SECONDARY) {
      break;
    }
  }
  return out;
}

/**
 * Returns a shallow-cloned classification object with soft-coerced fields.
 * When hints remain unusable, strips them so the core ballot can still parse.
 */
export function coerceLlmClassificationJson(parsed: unknown): unknown {
  const record = asRecord(parsed);
  if (!record) {
    return parsed;
  }

  const next: Record<string, unknown> = { ...record };

  const interaction = coerceInteractionIntent(record.interactionIntent);
  if (interaction) {
    next.interactionIntent = interaction;
  }

  const primary = normalizeTaskIntentLabel(record.primaryTaskIntent);
  if (primary) {
    next.primaryTaskIntent = primary;
  }

  next.alternatives = coerceAlternatives(record.alternatives);
  next.secondaryTaskIntents = coerceSecondaryIntents(
    record.secondaryTaskIntents,
    typeof next.primaryTaskIntent === "string"
      ? next.primaryTaskIntent
      : undefined,
  );

  // Drop alternatives that duplicate the primary.
  if (typeof next.primaryTaskIntent === "string" && Array.isArray(next.alternatives)) {
    next.alternatives = (
      next.alternatives as Array<{ intent: string; confidence: number }>
    ).filter((alt) => alt.intent !== next.primaryTaskIntent);
  }

  if ("taskHints" in record && record.taskHints !== undefined) {
    next.taskHints = coerceTaskHints(record.taskHints);
  }

  return next;
}

/**
 * Drop taskHints so a valid core classification (intent + clarify flag) survives
 * when only the evidence block is malformed.
 */
export function stripTaskHints(parsed: unknown): unknown {
  const record = asRecord(parsed);
  if (!record || !("taskHints" in record)) {
    return parsed;
  }
  const { taskHints: _ignored, ...rest } = record;
  return rest;
}

/** Drop alternatives so a near-valid core ballot can parse. */
export function stripAlternatives(parsed: unknown): unknown {
  const record = asRecord(parsed);
  if (!record) {
    return parsed;
  }
  return { ...record, alternatives: [] };
}

/** Drop secondary intents + alternatives (core ballot only). */
export function stripSecondaryAndAlternatives(parsed: unknown): unknown {
  const record = asRecord(parsed);
  if (!record) {
    return parsed;
  }
  return {
    ...record,
    secondaryTaskIntents: [],
    alternatives: [],
  };
}

/**
 * Progressive salvage ladder for a near-valid ballot.
 * Tries full coerce → strip alternatives → strip secondary → strip hints.
 */
export function salvageLlmClassificationStages(parsed: unknown): unknown[] {
  const coerced = coerceLlmClassificationJson(parsed);
  return [
    coerced,
    stripAlternatives(coerced),
    stripSecondaryAndAlternatives(coerced),
    stripTaskHints(stripSecondaryAndAlternatives(coerced)),
  ];
}
