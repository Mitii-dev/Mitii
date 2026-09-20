import type {
  SystemContextGeneration,
  SystemContextKey,
  SystemContextReconcileResult,
  SystemContextSnapshot,
  SystemContextSourceDefinition,
  SystemContextSourceSnapshot,
  SystemContextUnavailable,
} from "./types";
import { SYSTEM_CONTEXT_UNAVAILABLE } from "./types";

const CONTEXT_TYPE_ID = Symbol.for("@mitii/SystemContext");

interface Rendered {
  readonly text: string;
  readonly snapshot: SystemContextSourceSnapshot;
}

type Compared =
  | { readonly kind: "incompatible" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "updated"; readonly render: () => Rendered };

interface Loaded {
  readonly baseline: () => Rendered;
  readonly compare: (previousEncoded: string) => Compared;
}

interface PackedSource {
  readonly key: SystemContextKey;
  readonly load: () => Loaded | SystemContextUnavailable;
}

interface AvailableEntry extends Loaded {
  readonly kind: "available";
  readonly key: SystemContextKey;
}

interface UnavailableEntry {
  readonly kind: "unavailable";
  readonly key: SystemContextKey;
}

type Entry = AvailableEntry | UnavailableEntry;

/** Opaque carrier for composable system context sources. */
export interface SystemContext {
  readonly [CONTEXT_TYPE_ID]: readonly PackedSource[];
}

export function isSystemContextUnavailable(
  value: unknown,
): value is SystemContextUnavailable {
  return value === SYSTEM_CONTEXT_UNAVAILABLE;
}

export function assertSystemContextKey(key: string): SystemContextKey {
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/.test(key)) {
    throw new Error(
      `Invalid system context key "${key}" (expected domain/name).`,
    );
  }
  return key;
}

/** Identity context. */
export function emptySystemContext(): SystemContext {
  return { [CONTEXT_TYPE_ID]: [] };
}

/** Closes a typed source into a context that composes with differently typed sources. */
export function makeSystemContextSource<A>(
  source: SystemContextSourceDefinition<A>,
): SystemContext {
  const key = assertSystemContextKey(source.key);
  return {
    [CONTEXT_TYPE_ID]: [
      {
        key,
        load: (): Loaded | SystemContextUnavailable => {
          const value = source.load();
          if (isSystemContextUnavailable(value)) {
            return value;
          }
          const snapshot = (): SystemContextSourceSnapshot => ({
            value: source.encode(value),
            ...(source.removed
              ? { removed: requireText(key, "removal", source.removed(value)) }
              : {}),
          });
          return {
            baseline: (): Rendered => ({
              text: requireText(key, "baseline", source.baseline(value)),
              snapshot: snapshot(),
            }),
            compare: (previousEncoded: string): Compared => {
              const decoded = source.decode(previousEncoded);
              if (decoded === undefined) {
                return { kind: "incompatible" };
              }
              if (source.equivalent(decoded, value)) {
                return { kind: "unchanged" };
              }
              return {
                kind: "updated",
                render: () => ({
                  text: requireText(
                    key,
                    "update",
                    source.update(decoded, value),
                  ),
                  snapshot: snapshot(),
                }),
              };
            },
          };
        },
      },
    ],
  };
}

/** Combines contexts in order; duplicate keys fail immediately. */
export function combineSystemContexts(
  values: readonly SystemContext[],
): SystemContext {
  const sources = values.flatMap((value) => value[CONTEXT_TYPE_ID]);
  assertUniqueKeys(sources);
  return { [CONTEXT_TYPE_ID]: sources };
}

function observe(context: SystemContext): Entry[] {
  return context[CONTEXT_TYPE_ID].map((source) => {
    const result = source.load();
    if (isSystemContextUnavailable(result)) {
      return { kind: "unavailable" as const, key: source.key };
    }
    return { kind: "available" as const, key: source.key, ...result };
  });
}

/**
 * Creates the immutable baseline and durable snapshot for a new generation.
 * Unavailable initial sources block initialization (OpenCode formula).
 */
export function initializeSystemContext(
  context: SystemContext,
  /** Optional pre-rendered full baseline (Mitii: assembled system prompt). */
  baselineOverride?: string,
):
  | { kind: "ready"; generation: SystemContextGeneration }
  | { kind: "blocked"; unavailableKeys: string[] } {
  const entries = observe(context);
  const unavailable = entries
    .filter((entry): entry is UnavailableEntry => entry.kind === "unavailable")
    .map((entry) => entry.key);
  if (unavailable.length > 0) {
    return { kind: "blocked", unavailableKeys: unavailable };
  }
  return {
    kind: "ready",
    generation: initializeObservation(entries, baselineOverride),
  };
}

function initializeObservation(
  entries: readonly Entry[],
  baselineOverride?: string,
): SystemContextGeneration {
  const available = entries.filter(
    (entry): entry is AvailableEntry => entry.kind === "available",
  );
  const rendered = available.map(
    (entry) => [entry.key, entry.baseline()] as const,
  );
  const sourceBaseline = joinRendered(rendered.map(([, result]) => result.text));
  return {
    baseline:
      baselineOverride !== undefined && baselineOverride.trim().length > 0
        ? baselineOverride
        : sourceBaseline,
    snapshot: Object.fromEntries(
      rendered.map(([key, result]) => [key, result.snapshot]),
    ),
  };
}

/**
 * Reconcile current sources with the active snapshot.
 * OpenCode: Unchanged | Updated | ReplacementReady | ReplacementBlocked.
 */
export function reconcileSystemContext(params: {
  context: SystemContext;
  previous: SystemContextSnapshot;
  /** When true, force replacement path (compaction / epoch fence). */
  forceReplace?: boolean;
  baselineOverride?: string;
}): SystemContextReconcileResult {
  const entries = observe(params.context);
  if (params.forceReplace) {
    return replaceObservation(entries, params.previous, params.baselineOverride);
  }
  const soft = reconcileObservation(entries, params.previous);
  if (soft.kind === "unchanged" || soft.kind === "updated") {
    return soft;
  }
  return replaceObservation(entries, params.previous, params.baselineOverride);
}

function reconcileObservation(
  entries: readonly Entry[],
  previous: SystemContextSnapshot,
):
  | { kind: "unchanged" }
  | {
      kind: "updated";
      text: string;
      snapshot: SystemContextSnapshot;
      changedKeys: string[];
    }
  | { kind: "replace" } {
  const keys = new Set(entries.map((entry) => entry.key));
  const comparisons = new Map<string, Compared>();

  for (const entry of entries) {
    if (entry.kind === "unavailable") {
      continue;
    }
    const stored = previous[entry.key];
    if (!stored) {
      continue;
    }
    const compared = entry.compare(stored.value);
    if (compared.kind === "incompatible") {
      return { kind: "replace" };
    }
    comparisons.set(entry.key, compared);
  }

  for (const key of Object.keys(previous).sort()) {
    if (keys.has(key)) {
      continue;
    }
    if (previous[key]?.removed === undefined) {
      return { kind: "replace" };
    }
  }

  const snapshot: Record<string, SystemContextSourceSnapshot> = {};
  const updates: string[] = [];
  const changedKeys: string[] = [];

  for (const entry of entries) {
    const stored = previous[entry.key];
    if (entry.kind === "unavailable") {
      if (stored) {
        snapshot[entry.key] = stored;
      }
      continue;
    }
    if (!stored) {
      const rendered = entry.baseline();
      updates.push(rendered.text);
      snapshot[entry.key] = rendered.snapshot;
      changedKeys.push(entry.key);
      continue;
    }
    const compared = comparisons.get(entry.key);
    if (!compared || compared.kind === "incompatible") {
      throw new Error(`Missing comparison for system context source ${entry.key}`);
    }
    if (compared.kind === "unchanged") {
      snapshot[entry.key] = stored;
      continue;
    }
    const rendered = compared.render();
    updates.push(rendered.text);
    snapshot[entry.key] = rendered.snapshot;
    changedKeys.push(entry.key);
  }

  for (const key of Object.keys(previous).sort()) {
    if (keys.has(key)) {
      continue;
    }
    const removed = previous[key]?.removed;
    if (removed === undefined) {
      throw new Error(`Missing removal rendering for system context source ${key}`);
    }
    updates.push(removed);
    changedKeys.push(key);
  }

  if (updates.length === 0) {
    return { kind: "unchanged" };
  }
  return {
    kind: "updated",
    text: joinRendered(updates),
    snapshot,
    changedKeys,
  };
}

/** Fresh generation after compaction / incompatible transition, or blocked. */
export function replaceSystemContext(params: {
  context: SystemContext;
  previous: SystemContextSnapshot;
  baselineOverride?: string;
}): SystemContextReconcileResult {
  return replaceObservation(
    observe(params.context),
    params.previous,
    params.baselineOverride,
  );
}

function replaceObservation(
  entries: readonly Entry[],
  previous: SystemContextSnapshot,
  baselineOverride?: string,
): SystemContextReconcileResult {
  const unavailableKeys = entries
    .filter(
      (entry): entry is UnavailableEntry =>
        entry.kind === "unavailable" && previous[entry.key] !== undefined,
    )
    .map((entry) => entry.key);
  if (unavailableKeys.length > 0) {
    return {
      kind: "replace_blocked",
      reason: "admitted_context_unavailable",
      unavailableKeys,
    };
  }
  return {
    kind: "replace_ready",
    generation: initializeObservation(entries, baselineOverride),
  };
}

function joinRendered(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join("\n\n");
}

function requireText(key: SystemContextKey, kind: string, text: string): string {
  if (text.length === 0) {
    throw new Error(`System context source ${key} rendered an empty ${kind}`);
  }
  return text;
}

function assertUniqueKeys(sources: readonly PackedSource[]): void {
  const keys = new Set<string>();
  for (const source of sources) {
    if (keys.has(source.key)) {
      throw new Error(`Duplicate system context key: ${source.key}`);
    }
    keys.add(source.key);
  }
}

/** JSON string codec helpers for simple string / string[] sources. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

export function decodeJsonString(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function decodeJsonStringArray(raw: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    if (!parsed.every((item) => typeof item === "string")) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}
