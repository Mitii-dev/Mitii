/**
 * Soft-coerce common LLM shape drift so a near-valid ballot is not discarded.
 * Strict Zod still runs after this — coercion only maps known aliases / shapes.
 */

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

/**
 * Returns a shallow-cloned classification object with soft-coerced taskHints.
 * When hints remain unusable, strips them so the core ballot can still parse.
 */
export function coerceLlmClassificationJson(parsed: unknown): unknown {
  const record = asRecord(parsed);
  if (!record) {
    return parsed;
  }

  if (!("taskHints" in record) || record.taskHints === undefined) {
    return parsed;
  }

  return {
    ...record,
    taskHints: coerceTaskHints(record.taskHints),
  };
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
