/**
 * S3A-WINDOW — host contextWindowTokens is SSOT; band must match (§6.5).
 * Fail loud when host says wide window but band resolves compact.
 */

import {
  resolveWindowBudgetBand,
  type WindowBudgetBand,
  type WindowPolicy,
} from "../../../modules/window-budget";

export interface AssertWindowBandInput {
  contextWindowTokens: number;
  /** Optional expected band from host telemetry. */
  expectedBand?: WindowBudgetBand;
  /** Policy already derived — band inferred from its tokens when present. */
  policy?: Pick<WindowPolicy, "contextWindowTokens">;
}

export interface AssertWindowBandResult {
  ok: boolean;
  band: WindowBudgetBand;
  contextWindowTokens: number;
  reasonCodes: string[];
}

export function assertWindowBand(
  input: AssertWindowBandInput,
): AssertWindowBandResult {
  const tokens =
    input.policy?.contextWindowTokens ?? input.contextWindowTokens;
  const band = resolveWindowBudgetBand(tokens);
  const reasonCodes = [
    `window_band_${band}`,
    `window_tokens_${tokens}`,
  ];

  if (input.expectedBand && input.expectedBand !== band) {
    return {
      ok: false,
      band,
      contextWindowTokens: tokens,
      reasonCodes: [
        ...reasonCodes,
        "window_band_mismatch",
        `window_band_expected_${input.expectedBand}`,
      ],
    };
  }

  // Loud misconfig: host advertised ≥100k but we somehow treated as compact.
  if (tokens >= 100_000 && band === "compact") {
    return {
      ok: false,
      band,
      contextWindowTokens: tokens,
      reasonCodes: [...reasonCodes, "window_band_misconfig_loud"],
    };
  }

  return {
    ok: true,
    band,
    contextWindowTokens: tokens,
    reasonCodes: [...reasonCodes, "window_band_ok"],
  };
}

/**
 * Split run soft caps into plan-phase vs execute-phase envelopes (S3A-WINDOW).
 * Plan phase gets a minority share so discovery cannot exhaust the hard cap.
 */
export function splitPlanExecuteBudgets(input: {
  maxModelCalls: number;
  hardMaxModelCalls: number;
  maxToolCalls: number;
  hardMaxToolCalls: number;
  /** Fraction reserved for plan/discovery (default 0.35). */
  planShare?: number;
}): {
  plan: {
    maxModelCalls: number;
    hardMaxModelCalls: number;
    maxToolCalls: number;
    hardMaxToolCalls: number;
  };
  execute: {
    maxModelCalls: number;
    hardMaxModelCalls: number;
    maxToolCalls: number;
    hardMaxToolCalls: number;
  };
  reasonCodes: string[];
} {
  const share = Math.min(0.5, Math.max(0.15, input.planShare ?? 0.35));
  const planModels = Math.max(1, Math.floor(input.maxModelCalls * share));
  const planHardModels = Math.max(
    planModels,
    Math.floor(input.hardMaxModelCalls * share),
  );
  const planTools = Math.max(1, Math.floor(input.maxToolCalls * share));
  const planHardTools = Math.max(
    planTools,
    Math.floor(input.hardMaxToolCalls * share),
  );

  return {
    plan: {
      maxModelCalls: planModels,
      hardMaxModelCalls: planHardModels,
      maxToolCalls: planTools,
      hardMaxToolCalls: planHardTools,
    },
    execute: {
      maxModelCalls: Math.max(1, input.maxModelCalls - planModels),
      hardMaxModelCalls: Math.max(
        1,
        input.hardMaxModelCalls - planHardModels,
      ),
      maxToolCalls: Math.max(1, input.maxToolCalls - planTools),
      hardMaxToolCalls: Math.max(1, input.hardMaxToolCalls - planHardTools),
    },
    reasonCodes: [
      "window_plan_execute_split",
      `window_plan_share_${Math.round(share * 100)}`,
    ],
  };
}
