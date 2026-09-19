import type {
  ContextEpoch,
  ContextEpochReconcileResult,
  ContextEpochSnapshot,
} from "./types";

/** OpenCode-style privileged system context source keys Mitii tracks. */
export const CONTEXT_EPOCH_SOURCE_KEYS = {
  baselineSystem: "system.baseline",
  route: "system.route",
  planningDepth: "system.planning_depth",
  skills: "instructions.skills",
  rules: "instructions.rules",
  environment: "instructions.environment",
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
  sources: Readonly<Record<string, string>>;
  nowMs: number;
  epochId?: string;
}): ContextEpoch {
  const baseline = params.baselineSystemText;
  if (!baseline.trim()) {
    throw new Error("Context epoch baseline system text must be non-empty.");
  }
  return {
    epochId: params.epochId ?? `epoch_${params.runId}_${params.nowMs}`,
    runId: params.runId,
    baselineSystemText: baseline,
    baselineHash: hashContextText(baseline),
    structuredSnapshot: buildContextEpochSnapshot(params.sources),
    createdAtMs: params.nowMs,
    replacementRequested: false,
  };
}

/**
 * Compare newly observed sources to the active epoch.
 * OpenCode formula: unchanged | updated | replace_ready | replace_blocked.
 */
export function reconcileContextEpoch(params: {
  epoch: ContextEpoch;
  observedSources: Readonly<Record<string, string>>;
  baselineAvailable: boolean;
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
  const previous = params.epoch.structuredSnapshot.sources;
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
  };
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
  sources: Readonly<Record<string, string>>;
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
      message.content.trim().length > 0,
  );
  return system?.content;
}
