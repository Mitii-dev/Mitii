import type { V8EngineThresholdsOverrides } from "../policy";
import { resolveV8EngineThresholds, type V8EngineThresholds } from "../policy";

/**
 * Window bands for shipped v8-engine knobs.
 * Same cutoffs as loop/window policy (compact < 50k, standard < 100k, else wide).
 * Edit via `pnpm policy-admin` or this file.
 */
export const V8_ENGINE_BANDS = ["compact", "standard", "wide"] as const;
export type V8EngineBand = (typeof V8_ENGINE_BANDS)[number];

export const V8_ENGINE_BAND_CEILINGS = {
  compactMaxExclusive: 50_000,
  standardMaxExclusive: 100_000,
} as const;

export interface V8EngineBandDefinition {
  id: V8EngineBand;
  label: string;
  rangeLabel: string;
  overrides: V8EngineThresholdsOverrides;
}

export const V8_ENGINE_BAND_TABLE: Record<
  V8EngineBand,
  V8EngineBandDefinition
> = {
  compact: {
    id: "compact",
    label: "Compact",
    rangeLabel: "< 50k",
    overrides: {
      maxReadOnlyTurnsBeforeMutationNudge: 8,
      maxTruncationRecoveries: 4,
      maxUnfulfilledExecuteRecoveries: 3,
      maxReasoningCharsWithoutProgress: 20_000,
    },
  },
  standard: {
    id: "standard",
    label: "Standard",
    rangeLabel: "50k – < 100k",
    // Empty on purpose: base V8_ENGINE_THRESHOLDS are the standard band.
    overrides: {},
  },
  wide: {
    id: "wide",
    label: "Wide",
    rangeLabel: "≥ 100k",
    overrides: {
      maxReasoningCharsWithoutProgress: 40_000,
      maxContinueOverrides: 5,
      preferredBatchSize: 16,
    },
  },
};

export function resolveV8EngineBand(
  contextWindowTokens: number,
): V8EngineBand {
  const w = Math.floor(contextWindowTokens);
  if (!Number.isFinite(w) || w < V8_ENGINE_BAND_CEILINGS.compactMaxExclusive) {
    return "compact";
  }
  if (w < V8_ENGINE_BAND_CEILINGS.standardMaxExclusive) {
    return "standard";
  }
  return "wide";
}

export function v8EngineBandDefinition(
  band: V8EngineBand,
): V8EngineBandDefinition {
  return V8_ENGINE_BAND_TABLE[band];
}

export function listV8EngineBands(): readonly V8EngineBandDefinition[] {
  return V8_ENGINE_BANDS.map((id) => V8_ENGINE_BAND_TABLE[id]);
}

export type ResolveV8LoopPolicyInput = {
  contextWindowTokens: number;
  overrides?: V8EngineThresholdsOverrides;
};

export type ResolvedV8LoopPolicy = {
  band: V8EngineBand;
  contextWindowTokens: number;
  thresholds: V8EngineThresholds;
};

/**
 * Merge order: V8_ENGINE_THRESHOLDS → band overrides → optional host Custom.
 */
export function resolveV8LoopPolicyThresholds(
  input: ResolveV8LoopPolicyInput,
): ResolvedV8LoopPolicy {
  const band = resolveV8EngineBand(input.contextWindowTokens);
  const bandOverrides = V8_ENGINE_BAND_TABLE[band].overrides;
  return {
    band,
    contextWindowTokens: input.contextWindowTokens,
    thresholds: resolveV8EngineThresholds({
      ...bandOverrides,
      ...(input.overrides ?? {}),
    }),
  };
}
