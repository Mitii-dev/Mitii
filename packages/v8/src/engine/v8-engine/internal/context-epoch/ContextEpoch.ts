import type {
  SystemContextSnapshot,
  SystemContextSourceSnapshot,
} from "../system-context";
import type {
  ContextEpoch,
  ContextEpochReconcileResult,
  ContextEpochSnapshot,
} from "./types";

/** OpenCode-style privileged system context source keys Mitii tracks. */
export const CONTEXT_EPOCH_SOURCE_KEYS = {
  /** @deprecated Prefer system-context SYSTEM_CONTEXT_SOURCE_KEYS; kept for tests. */
  baselineSystem: "system.baseline",
  route: "system/route",
  planningDepth: "system/planning_depth",
  skills: "instructions/skills",
  rules: "instructions/rules",
  environment: "instructions/environment",
  memory: "instructions/memory",
} as const;

/** Markers for Mid-Conversation System Messages (marked fragments). */
export const MID_CONVERSATION_SYSTEM_MARKERS = {
  start: "<context_epoch_update>",
  end: "</context_epoch_update>",
} as const;

export function hashContextText(text: string): string {
  // FNV-1a 32-bit — fast, stable, no crypto dependency in the runtime path.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Normalize legacy hash-only snapshots into OpenCode SourceSnapshot shape.
 * Bare strings become `{ value }` so SystemContext codecs can attempt decode.
 */
export function normalizeContextEpochSnapshot(
  snapshot: ContextEpochSnapshot,
): SystemContextSnapshot {
  const sources: Record<string, SystemContextSourceSnapshot> = {};
  for (const [key, raw] of Object.entries(snapshot.sources)) {
    if (typeof raw === "string") {
      sources[key] = { value: raw };
    } else if (raw && typeof raw === "object" && "value" in raw) {
      sources[key] = {
        value: raw.value,
        ...(typeof raw.removed === "string" ? { removed: raw.removed } : {}),
      };
    }
  }
  return sources;
}

export function buildContextEpochSnapshot(
  sources: Readonly<Record<string, string>>,
): ContextEpochSnapshot {
  const hashed: Record<string, string> = {};
  for (const [key, value] of Object.entries(sources)) {
    hashed[key] = hashContextText(value);
  }
  return { sources: hashed };
}

export function initializeContextEpoch(params: {
  runId: string;
  baselineSystemText: string;
  sources: Readonly<Record<string, string>> | SystemContextSnapshot;
  nowMs: number;
  epochId?: string;
}): ContextEpoch {
  const baseline = params.baselineSystemText;
  if (!baseline.trim()) {
    throw new Error("Context epoch baseline system text must be non-empty.");
  }
  const structuredSnapshot: ContextEpochSnapshot =
    isSystemContextSnapshot(params.sources)
      ? { sources: params.sources }
      : buildContextEpochSnapshot(params.sources);
  return {
    epochId: params.epochId ?? `epoch_${params.runId}_${params.nowMs}`,
    runId: params.runId,
    baselineSystemText: baseline,
    baselineHash: hashContextText(baseline),
    structuredSnapshot,
    createdAtMs: params.nowMs,
    replacementRequested: false,
  };
}

function isSystemContextSnapshot(
  sources: Readonly<Record<string, string>> | SystemContextSnapshot,
): sources is SystemContextSnapshot {
  const first = Object.values(sources)[0];
  return (
    first !== undefined &&
    typeof first === "object" &&
    first !== null &&
    "value" in first
  );
}

/**
 * Compare newly observed hash sources to the active epoch.
 * Prefer SystemContext.reconcile for production admit; kept for unit tests
 * and hash-based callers.
 *
 * OpenCode formula: unchanged | updated | replace_ready | replace_blocked.
 */
export function reconcileContextEpoch(params: {
  epoch: ContextEpoch;
  observedSources: Readonly<Record<string, string>>;
  baselineAvailable: boolean;
  /** Optional mid-conversation text when kind is updated. */
  midConversationText?: string;
}): ContextEpochReconcileResult {
  if (params.epoch.replacementRequested) {
    if (!params.baselineAvailable) {
      return {
        kind: "replace_blocked",
        epoch: params.epoch,
        reason: "replacement_requested_but_baseline_unavailable",
      };
    }
    return { kind: "replace_ready", epoch: params.epoch };
  }

  const observed = buildContextEpochSnapshot(params.observedSources);
  const previous = normalizeLegacyHashMap(params.epoch.structuredSnapshot);
  const changedSourceKeys: string[] = [];

  for (const [key, hash] of Object.entries(observed.sources)) {
    if (previous[key] !== hash) {
      changedSourceKeys.push(key);
    }
  }
  for (const key of Object.keys(previous)) {
    if (!(key in observed.sources) && !changedSourceKeys.includes(key)) {
      changedSourceKeys.push(key);
    }
  }

  if (changedSourceKeys.length === 0) {
    return { kind: "unchanged", epoch: params.epoch };
  }

  // Privileged baseline-affecting keys force replacement rather than mid-update.
  const baselineKeys = new Set<string>([
    CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem,
    CONTEXT_EPOCH_SOURCE_KEYS.route,
  ]);
  if (changedSourceKeys.some((key) => baselineKeys.has(key))) {
    return {
      kind: "replace_ready",
      epoch: {
        ...params.epoch,
        replacementRequested: true,
      },
    };
  }

  return {
    kind: "updated",
    epoch: {
      ...params.epoch,
      structuredSnapshot: observed,
    },
    changedSourceKeys,
    midConversationText:
      params.midConversationText ??
      `Context sources updated: ${changedSourceKeys.join(", ")}.`,
  };
}

function normalizeLegacyHashMap(
  snapshot: ContextEpochSnapshot,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(snapshot.sources)) {
    out[key] = typeof raw === "string" ? raw : raw.value;
  }
  return out;
}

export function markContextEpochForReplacement(
  epoch: ContextEpoch,
): ContextEpoch {
  if (epoch.replacementRequested) {
    return epoch;
  }
  return { ...epoch, replacementRequested: true };
}

/**
 * After compaction, fold current complete system context into a fresh baseline
 * (OpenCode: completed compaction starts a new Context Epoch).
 */
export function replaceContextEpoch(params: {
  previous: ContextEpoch;
  baselineSystemText: string;
  sources: Readonly<Record<string, string>> | SystemContextSnapshot;
  nowMs: number;
}): ContextEpoch {
  return initializeContextEpoch({
    runId: params.previous.runId,
    baselineSystemText: params.baselineSystemText,
    sources: params.sources,
    nowMs: params.nowMs,
    epochId: `epoch_${params.previous.runId}_${params.nowMs}`,
  });
}

export function extractBaselineSystemText(
  messages: readonly { role: string; content?: string }[],
): string | undefined {
  const system = messages.find(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      !isMidConversationSystemContent(message.content),
  );
  return system?.content;
}

export function isMidConversationSystemContent(content: string): boolean {
  const trimmedStart = content.trimStart();
  const trimmedEnd = content.trimEnd();
  return (
    trimmedStart
      .slice(0, MID_CONVERSATION_SYSTEM_MARKERS.start.length)
      .toLowerCase()
      .startsWith(MID_CONVERSATION_SYSTEM_MARKERS.start.toLowerCase()) &&
    trimmedEnd
      .slice(
        Math.max(
          0,
          trimmedEnd.length - MID_CONVERSATION_SYSTEM_MARKERS.end.length,
        ),
      )
      .toLowerCase()
      .endsWith(MID_CONVERSATION_SYSTEM_MARKERS.end.toLowerCase())
  );
}

export function wrapMidConversationSystemText(text: string): string {
  const body = text.trim();
  return `${MID_CONVERSATION_SYSTEM_MARKERS.start}\n${body}\n${MID_CONVERSATION_SYSTEM_MARKERS.end}`;
}
