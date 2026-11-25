import { DEFAULT_WINDOW_BUDGET_POLICY } from "../defaults";
import type {
  WindowBudgetPolicy,
  WindowBudgetPolicyOverrides,
} from "../types";
import {
  resolveWindowBudgetModelProfile,
  type WindowBudgetModelProfile,
} from "./modelProfiles";
import {
  resolveWindowBudgetMode,
  windowBudgetModeOverlay,
  type WindowBudgetMode,
} from "./mode";
import {
  resolveWindowBudgetBand,
  windowBudgetBandDefinition,
  type WindowBudgetBand,
  type WindowBudgetBandDefinition,
} from "./bands";

/**
 * Tunable Window Budget policy. Re-exported so hosts and tests import
 * defaults from one place instead of scattering literals.
 */
export const WINDOW_BUDGET_POLICY = DEFAULT_WINDOW_BUDGET_POLICY;

/**
 * Merge optional overrides onto base defaults (no window band).
 * Prefer `resolveWindowBudgetPolicy` when a context window is known.
 */
export function mergeWindowBudgetPolicy(
  overrides?: WindowBudgetPolicyOverrides,
): WindowBudgetPolicy {
  if (!overrides) {
    return { ...DEFAULT_WINDOW_BUDGET_POLICY };
  }
  return {
    ...DEFAULT_WINDOW_BUDGET_POLICY,
    ...stripUndefined(overrides),
  };
}

export interface ResolveWindowBudgetPolicyInput {
  contextWindowTokens: number;
  /**
   * Optional interaction-mode overlay (`ask` | `plan` | `agent`).
   * Applied after band, before lab overrides.
   */
  mode?: WindowBudgetMode | string;
  /**
   * Optional model id. When it matches a model profile, the profile overlay
   * is applied after the band and before the mode overlay.
   */
  modelId?: string;
  /** Profile table override (tests / hosts); defaults to the shipped table. */
  modelProfiles?: readonly WindowBudgetModelProfile[];
  /**
   * Optional host / Developer Custom overrides (`mitii.tokenBudget.*`).
   * Applied last; only defined keys replace band/mode.
   */
  overrides?: WindowBudgetPolicyOverrides;
}

export interface ResolvedWindowBudgetPolicy {
  band: WindowBudgetBand;
  bandDefinition: WindowBudgetBandDefinition;
  contextWindowTokens: number;
  bandOverrides: WindowBudgetPolicyOverrides;
  mode?: WindowBudgetMode;
  modeOverrides: WindowBudgetPolicyOverrides;
  /** Matched model profile id, when one applied. */
  modelProfileId?: string;
  /** Final policy: defaults → band → model profile → mode → lab. */
  policy: WindowBudgetPolicy;
}

/**
 * Resolve shipped window-budget policy for a context window.
 *
 * Merge order:
 * 1. `DEFAULT_WINDOW_BUDGET_POLICY`
 * 2. Window band overlays from `rules/bands.ts`
 * 3. Optional model profile from `rules/modelProfiles.ts`
 * 4. Optional mode overlays from `rules/mode.ts`
 * 5. Optional lab / host overrides
 */
export function resolveWindowBudgetPolicy(
  input: ResolveWindowBudgetPolicyInput,
): ResolvedWindowBudgetPolicy {
  const contextWindowTokens = Math.max(
    0,
    Math.floor(input.contextWindowTokens),
  );
  const band = resolveWindowBudgetBand(contextWindowTokens);
  const bandDefinition = windowBudgetBandDefinition(band);
  const bandOverrides = stripUndefined(bandDefinition.overrides);
  const modelProfile = resolveWindowBudgetModelProfile(
    input.modelId,
    input.modelProfiles,
  );
  const modelProfileOverrides = modelProfile
    ? stripUndefined(modelProfile.overrides)
    : {};
  const mode = resolveWindowBudgetMode(
    typeof input.mode === "string" ? input.mode : undefined,
  );
  const modeOverrides = mode
    ? stripUndefined(windowBudgetModeOverlay(mode).policy)
    : {};
  const labOverrides = input.overrides
    ? stripUndefined(input.overrides)
    : undefined;

  const policy: WindowBudgetPolicy = {
    ...DEFAULT_WINDOW_BUDGET_POLICY,
    ...bandOverrides,
    ...modelProfileOverrides,
    ...modeOverrides,
    ...labOverrides,
  };

  return {
    band,
    bandDefinition,
    contextWindowTokens,
    bandOverrides,
    ...(mode ? { mode } : {}),
    modeOverrides,
    ...(modelProfile ? { modelProfileId: modelProfile.id } : {}),
    policy,
  };
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
