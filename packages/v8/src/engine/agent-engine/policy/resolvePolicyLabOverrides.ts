import type { AgentEngineThresholdsOverrides } from "../actions/resolveAgentEngineThresholds";
import type { WindowBudgetPolicyOverrides } from "../../../modules/window-budget/contracts";
import {
  resolveWindowBudgetBand,
  type WindowBudgetBand,
} from "../../../modules/window-budget/windowBudgetBands";
import {
  resolveLoopPolicyWindowBand,
  type LoopPolicyWindowBand,
} from "./loopPolicyBands";
import type { PolicyLabFile } from "./policyLab";

export interface ResolvePolicyLabOverridesInput {
  lab: PolicyLabFile | undefined;
  contextWindowTokens: number;
}

export interface ResolvedPolicyLabOverrides {
  enabled: boolean;
  band: LoopPolicyWindowBand & WindowBudgetBand;
  loopOverrides: AgentEngineThresholdsOverrides | undefined;
  windowOverrides: WindowBudgetPolicyOverrides | undefined;
}

/**
 * Pick band-scoped lab overrides for the active context window.
 * Returns undefined override objects when lab is off or the band has no entries.
 */
export function resolvePolicyLabOverrides(
  input: ResolvePolicyLabOverridesInput,
): ResolvedPolicyLabOverrides {
  const band = resolveLoopPolicyWindowBand(input.contextWindowTokens);
  // Same cutoffs as window budget; keep one id for callers.
  const windowBand = resolveWindowBudgetBand(input.contextWindowTokens);
  const activeBand = band === windowBand ? band : windowBand;

  const lab = input.lab;
  if (!lab?.enabled) {
    return {
      enabled: false,
      band: activeBand,
      loopOverrides: undefined,
      windowOverrides: undefined,
    };
  }

  const loopRaw = lab.loop[activeBand];
  const windowRaw = lab.window[activeBand];
  const loopOverrides =
    loopRaw && Object.keys(loopRaw).length > 0 ? loopRaw : undefined;
  const windowOverrides =
    windowRaw && Object.keys(windowRaw).length > 0 ? windowRaw : undefined;

  return {
    enabled: true,
    band: activeBand,
    loopOverrides,
    windowOverrides,
  };
}

/**
 * Merge lab overrides under host Custom overrides (lab first, Custom wins).
 */
export function mergeLabUnderHostOverrides<T extends object>(
  lab: T | undefined,
  host: T | undefined,
): T | undefined {
  if (!lab && !host) return undefined;
  return {
    ...(lab ?? {}),
    ...(host ?? {}),
  } as T;
}
