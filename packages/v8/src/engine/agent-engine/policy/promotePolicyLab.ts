import type { AgentEngineThresholdsOverrides } from "../actions/resolveAgentEngineThresholds";
import type { WindowBudgetPolicyOverrides } from "../../../modules/window-budget/contracts";
import type { WindowBudgetBand } from "../../../modules/window-budget/windowBudgetBands";
import type { PolicyLabFile } from "./policyLab";
import type { LoopPolicyWindowBand } from "./loopPolicyBands";

export interface PromotePolicyLabInput {
  lab: PolicyLabFile;
  /** Band to promote. Defaults to every band that has lab overrides. */
  bands?: readonly (LoopPolicyWindowBand | WindowBudgetBand)[];
}

export interface PromotePolicyLabResult {
  /** TypeScript snippet for `loopPolicyBands.ts` table entries. */
  loopSnippet: string;
  /** TypeScript snippet for `windowBudgetBands.ts` table entries. */
  windowSnippet: string;
  /** Human summary of what would ship. */
  summary: string;
  /** True when there is nothing non-empty to promote. */
  empty: boolean;
}

/**
 * Generate ship-ready TypeScript snippets from a Policy Lab file.
 * Does not write files — hosts copy to clipboard or a CLI can apply.
 */
export function promotePolicyLabToShip(
  input: PromotePolicyLabInput,
): PromotePolicyLabResult {
  const bands = input.bands?.length
    ? input.bands
    : (["compact", "standard", "wide"] as const);

  const loopParts: string[] = [];
  const windowParts: string[] = [];
  let loopCount = 0;
  let windowCount = 0;

  for (const band of bands) {
    const loopOverrides = input.lab.loop[band] ?? {};
    const windowOverrides = input.lab.window[band] ?? {};
    const loopKeys = Object.keys(loopOverrides).filter(
      (key) =>
        (loopOverrides as Record<string, unknown>)[key] !== undefined,
    );
    const windowKeys = Object.keys(windowOverrides).filter(
      (key) =>
        (windowOverrides as Record<string, unknown>)[key] !== undefined,
    );

    if (loopKeys.length > 0) {
      loopCount += loopKeys.length;
      loopParts.push(formatBandOverrides(band, loopOverrides));
    }
    if (windowKeys.length > 0) {
      windowCount += windowKeys.length;
      windowParts.push(formatBandOverrides(band, windowOverrides));
    }
  }

  const empty = loopCount === 0 && windowCount === 0;
  const summary = empty
    ? "No lab overrides to promote."
    : `Promote ${loopCount} loop knob(s) and ${windowCount} window knob(s) into ship band tables.`;

  return {
    loopSnippet: loopParts.length
      ? [
          "// Paste into LOOP_POLICY_WINDOW_BAND_TABLE.<band>.overrides",
          "// packages/v8/src/engine/agent-engine/policy/loopPolicyBands.ts",
          "",
          ...loopParts,
        ].join("\n")
      : "// (no loop lab overrides)",
    windowSnippet: windowParts.length
      ? [
          "// Paste into WINDOW_BUDGET_BAND_TABLE.<band>.overrides",
          "// packages/v8/src/modules/window-budget/windowBudgetBands.ts",
          "",
          ...windowParts,
        ].join("\n")
      : "// (no window lab overrides)",
    summary,
    empty,
  };
}

/**
 * Diff lab loop overrides against an already-resolved band baseline so
 * Promote only ships deltas that differ from ship standards.
 */
export function labLoopDeltas(
  labOverrides: AgentEngineThresholdsOverrides | undefined,
  bandThresholds: Readonly<Record<string, number>>,
): AgentEngineThresholdsOverrides {
  if (!labOverrides) return {};
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(labOverrides)) {
    if (value === undefined) continue;
    if (bandThresholds[key] === value) continue;
    next[key] = value;
  }
  return next;
}

/**
 * Diff lab window overrides against band ship overlays (not full defaults).
 */
export function labWindowDeltas(
  labOverrides: WindowBudgetPolicyOverrides | undefined,
  bandOverrides: WindowBudgetPolicyOverrides,
  baseDefaults: Readonly<Record<string, number>>,
): WindowBudgetPolicyOverrides {
  if (!labOverrides) return {};
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(labOverrides)) {
    if (value === undefined) continue;
    const shipped =
      (bandOverrides as Record<string, number | undefined>)[key] ??
      baseDefaults[key];
    if (shipped === value) continue;
    next[key] = value;
  }
  return next;
}

function formatBandOverrides(
  band: string,
  overrides: Record<string, unknown> | object,
): string {
  const entries = Object.entries(overrides).filter(
    ([, value]) => value !== undefined,
  );
  const body = entries
    .map(([key, value]) => `    ${key}: ${formatLiteral(value)},`)
    .join("\n");
  return `${band}: {\n  overrides: {\n${body}\n  },\n},`;
}

function formatLiteral(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}
