export const DEFAULT_WARN_RATIO = 0.7;
export const DEFAULT_AUTO_RATIO = 0.8;
export const DEFAULT_HARD_RATIO = 0.92;

export type ModelLoopCompactionPressure = "within" | "warn" | "auto" | "hard";

export interface ModelLoopCompactionThresholds {
  warnTokens: number;
  autoTokens: number;
  hardTokens: number;
}

export function resolveCompactionThresholds(params: {
  budgetTokens: number;
  warnRatio?: number;
  autoRatio?: number;
  hardRatio?: number;
  autoMaxTokens?: number;
  hardMaxTokens?: number;
  preservePrefix?: boolean;
}): ModelLoopCompactionThresholds {
  const budgetTokens = Math.max(1, Math.floor(params.budgetTokens));
  const warnRatio = clampRatio(params.warnRatio ?? DEFAULT_WARN_RATIO);
  const autoRatio = clampRatio(params.autoRatio ?? DEFAULT_AUTO_RATIO);
  const hardRatio = clampRatio(params.hardRatio ?? DEFAULT_HARD_RATIO);
  const sorted = [warnRatio, autoRatio, hardRatio].sort((a, b) => a - b);

  let warnTokens = Math.max(1, Math.floor(budgetTokens * sorted[0]!));
  let autoTokens = Math.max(1, Math.floor(budgetTokens * sorted[1]!));
  let hardTokens = Math.max(1, Math.floor(budgetTokens * sorted[2]!));

  if (params.autoMaxTokens !== undefined) {
    autoTokens = Math.min(autoTokens, Math.max(1, Math.floor(params.autoMaxTokens)));
  }
  if (params.hardMaxTokens !== undefined) {
    hardTokens = Math.min(hardTokens, Math.max(1, Math.floor(params.hardMaxTokens)));
  }
  if (params.preservePrefix) {
    autoTokens = hardTokens;
    warnTokens = Math.min(warnTokens, autoTokens);
  }
  if (autoTokens < warnTokens) {
    warnTokens = autoTokens;
  }
  if (hardTokens < autoTokens) {
    hardTokens = autoTokens;
  }

  return {
    warnTokens,
    autoTokens,
    hardTokens,
  };
}

export function resolveCompactionPressure(params: {
  usedTokens: number;
  thresholds: ModelLoopCompactionThresholds;
}): ModelLoopCompactionPressure {
  if (params.usedTokens >= params.thresholds.hardTokens) {
    return "hard";
  }
  if (params.usedTokens >= params.thresholds.autoTokens) {
    return "auto";
  }
  if (params.usedTokens >= params.thresholds.warnTokens) {
    return "warn";
  }
  return "within";
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AUTO_RATIO;
  }
  return Math.min(1, Math.max(0.01, value));
}
