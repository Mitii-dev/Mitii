/**
 * System Context formulae injected from OpenCode CONTEXT.md / system-context.
 *
 * Mitii-shaped (no Effect): typed sources compose into an opaque carrier;
 * interpreters observe once and produce Generation | Updated | Replacement*.
 *
 * Language (OpenCode):
 * - Context Source: independently observed typed value with baseline/update/removal renderers
 * - Context Snapshot: model-hidden JSON state for comparison
 * - Baseline System Context: immutable provider-cache prefix for one Context Epoch
 * - Mid-Conversation System Message: chronological admission of changed sources
 * - Unavailable Context: temporary observe failure → stale-while-revalidate
 */

/** Temporary inability to observe a source (stale-while-revalidate). */
export const SYSTEM_CONTEXT_UNAVAILABLE = Symbol.for(
  "@mitii/SystemContext.Unavailable",
);
export type SystemContextUnavailable = typeof SYSTEM_CONTEXT_UNAVAILABLE;

/**
 * Stable namespaced key (`domain/name`).
 * OpenCode: /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/
 */
export type SystemContextKey = string;

/** Durable comparison state for one admitted source. */
export interface SystemContextSourceSnapshot {
  /** Codec-encoded JSON (string) value last admitted. */
  readonly value: string;
  /** Pre-rendered removal text for dynamic removable sources. */
  readonly removed?: string;
}

/** Durable structured comparison state for one active context generation. */
export type SystemContextSnapshot = Readonly<
  Record<string, SystemContextSourceSnapshot>
>;

export interface SystemContextGeneration {
  /** Exact joined baseline text used as the provider-cache prefix. */
  readonly baseline: string;
  readonly snapshot: SystemContextSnapshot;
}

export type SystemContextReconcileResult =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "updated";
      /** Combined Mid-Conversation System Message text. */
      readonly text: string;
      readonly snapshot: SystemContextSnapshot;
      readonly changedKeys: readonly string[];
    }
  | {
      readonly kind: "replace_ready";
      readonly generation: SystemContextGeneration;
    }
  | {
      readonly kind: "replace_blocked";
      readonly reason: string;
      readonly unavailableKeys: readonly string[];
    };

/**
 * One typed source before value type is hidden by `makeSystemContextSource`.
 * Loaders return the value or UNAVAILABLE (not removal).
 */
export interface SystemContextSourceDefinition<A> {
  readonly key: SystemContextKey;
  readonly encode: (value: A) => string;
  readonly decode: (raw: string) => A | undefined;
  readonly equivalent: (left: A, right: A) => boolean;
  readonly load: () => A | SystemContextUnavailable;
  readonly baseline: (current: A) => string;
  readonly update: (previous: A, current: A) => string;
  readonly removed?: (previous: A) => string;
}
