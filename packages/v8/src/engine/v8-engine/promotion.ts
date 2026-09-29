import type { V8EngineImplementation } from "./constants";
import { V8_ENGINE_IMPLEMENTATIONS } from "./constants";

/**
 * Phase 5 promotion controls.
 *
 * Product default is `v8` after always-on goldens are green. Legacy remains
 * selectable via `mitii.engine.implementation` / `engineImplementation: "legacy"`.
 * Soak tracking lives here so hosts/CI can gate further promotion ritual.
 */
export const V8_ENGINE_PROMOTION = {
  /** Default orchestrator for composeAgentEngine / createMitiiClient when unset. */
  defaultImplementation: "v8" as V8EngineImplementation,
  /** Calendar days of green always-on goldens recommended before declaring soak done. */
  soakDaysRequired: 7,
  /**
   * Promotion ritual status. `promoted` means v8 is the shipped default;
   * legacy stays as fallback for one release.
   */
  status: "promoted" as "eval_only" | "soak" | "promoted",
  /** Human-readable rollback: set settings/env back to legacy. */
  rollback: {
    setting: "mitii.engine.implementation",
    settingValue: "legacy",
    env: "MITII_ENGINE_IMPLEMENTATION=legacy",
    compose: 'composeAgentEngine({ implementation: "legacy", ... })',
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
