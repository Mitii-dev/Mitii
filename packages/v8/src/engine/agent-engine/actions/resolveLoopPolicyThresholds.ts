import { AGENT_ENGINE_THRESHOLDS } from "../policy";
import {
  loopPolicyWindowBandDefinition,
  resolveLoopPolicyWindowBand,
  type LoopPolicyWindowBand,
  type LoopPolicyWindowBandDefinition,
} from "../policy/loopPolicyBands";
import {
  agentEngineThresholdsOverridesSchema,
  resolveAgentEngineThresholds,
  type AgentEngineThresholds,
  type AgentEngineThresholdsOverrides,
} from "./resolveAgentEngineThresholds";

export interface ResolveLoopPolicyThresholdsInput {
  /**
   * Effective model context window for this run (capabilities / provider setting).
   * Selects the shipped window band before lab overrides apply.
   */
  contextWindowTokens: number;
  /**
   * Optional host / Developer lab overrides (`mitii.loopPolicy.*`).
   * Applied last; only defined keys replace band values.
   */
  overrides?: AgentEngineThresholdsOverrides;
}

export interface ResolvedLoopPolicy {
  /** Selected window band for this context window. */
  band: LoopPolicyWindowBand;
  /** Band metadata (label, range, raw overrides). */
  bandDefinition: LoopPolicyWindowBandDefinition;
  /** Effective context window used for band selection. */
  contextWindowTokens: number;
  /** Band overrides only (before lab). */
  bandOverrides: AgentEngineThresholdsOverrides;
  /** Final thresholds: base → band → lab. */
  thresholds: AgentEngineThresholds;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const next: Partial<T> = {};
  for (const [key, entry] of Object.entries(value) as Array<
    [keyof T, T[keyof T] | undefined]
  >) {
    if (entry !== undefined) {
      next[key] = entry;
    }
  }
  return next;
}

/**
 * Resolve shipped loop/stall thresholds for a context window.
 *
 * Merge order:
 * 1. `AGENT_ENGINE_THRESHOLDS` (base working standards)
 * 2. Window band overrides from `policy/loopPolicyBands.ts`
 * 3. Optional lab overrides (Developer Custom loop policy)
 */
export function resolveLoopPolicyThresholds(
  input: ResolveLoopPolicyThresholdsInput,
): ResolvedLoopPolicy {
  const contextWindowTokens = Math.max(
    0,
    Math.floor(input.contextWindowTokens),
  );
  const band = resolveLoopPolicyWindowBand(contextWindowTokens);
  const bandDefinition = loopPolicyWindowBandDefinition(band);
  const bandOverrides = agentEngineThresholdsOverridesSchema.parse(
    bandDefinition.overrides,
  );
  const labOverrides = input.overrides
    ? agentEngineThresholdsOverridesSchema.parse(input.overrides)
    : undefined;

  const thresholds = resolveAgentEngineThresholds({
    ...bandOverrides,
    ...stripUndefined(labOverrides ?? {}),
  });

  return {
    band,
    bandDefinition,
    contextWindowTokens,
    bandOverrides,
    thresholds,
  };
}

/**
 * Band-only thresholds (no lab overrides). Useful for Developer UI prefills
 * and "Reset to standards" previews.
 */
export function resolveLoopPolicyBandThresholds(
  contextWindowTokens: number,
): ResolvedLoopPolicy {
  return resolveLoopPolicyThresholds({ contextWindowTokens });
}

/** @internal test helper — base constants still exported from policy.ts */
export function baseAgentEngineThresholds(): AgentEngineThresholds {
  return { ...AGENT_ENGINE_THRESHOLDS };
}
