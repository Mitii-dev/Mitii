import type { V8EngineImplementation } from "./constants";
import { V8_ENGINE_IMPLEMENTATIONS } from "./constants";

/**
 * Product default is `v8`. The `legacy` setting/env value still parses but
 * always resolves to `v8` — there is no second orchestrator tree.
 */
export const V8_ENGINE_PROMOTION = {
  /** Default orchestrator for composeAgentEngine / createMitiiClient when unset. */
  defaultImplementation: "v8" as V8EngineImplementation,
  /** Calendar days of green always-on goldens recommended before declaring soak done. */
  soakDaysRequired: 7,
  /**
   * `promoted` means v8 is the sole orchestrator.
   * `legacy` is a compatibility alias only.
   */
  status: "promoted" as "eval_only" | "soak" | "promoted",
  /**
   * Former rollback knobs — kept for hosts that still write `legacy`.
   * All paths resolve to v8.
   */
  rollback: {
    setting: "mitii.engine.implementation",
    settingValue: "v8",
    env: "MITII_ENGINE_IMPLEMENTATION=v8",
    compose: 'composeAgentEngine({ implementation: "v8", ... })',
    note: "legacy aliases to v8",
  },
  /** Always-on golden suite id (vitest path glob). */
  alwaysOnGoldenGlob: "src/engine/v8-engine/tests/**/*.spec.ts",
  curatedCatalogPath: "src/engine/v8-engine/tests/eval/curated-40.json",
} as const;

export type V8EnginePromotion = typeof V8_ENGINE_PROMOTION;

export function defaultV8EngineImplementation(): V8EngineImplementation {
  return V8_ENGINE_PROMOTION.defaultImplementation;
}

export function isKnownV8EngineImplementation(
  value: unknown,
): value is V8EngineImplementation {
  return (
    typeof value === "string" &&
    (V8_ENGINE_IMPLEMENTATIONS as readonly string[]).includes(value)
  );
}
