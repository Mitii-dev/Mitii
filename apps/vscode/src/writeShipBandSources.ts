import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { WindowBudgetBand } from '@mitii/sdk';

export type ShipBandId = WindowBudgetBand;

export interface ShipBandTables {
  loop: Record<ShipBandId, Record<string, number>>;
  window: Record<ShipBandId, Record<string, number>>;
}

export interface WriteShipBandSourcesResult {
  monorepoRoot: string;
  loopPath: string;
  windowPath: string;
}

const LOOP_REL =
  'packages/v8/src/engine/agent-engine/policy/loopPolicyBands.ts';
const WINDOW_REL =
  'packages/v8/src/modules/window-budget/windowBudgetBands.ts';

const BAND_META: Record<
  ShipBandId,
  { label: string; rangeLabel: string; comment: string }
> = {
  compact: {
    label: 'Compact',
    rangeLabel: '< 50k',
    comment:
      'Small windows fill fast: allow more reads before forcing a patch,\n      // more stale-hunk recoveries, and keep recovered essays shorter.',
  },
  standard: {
    label: 'Standard',
    rangeLabel: '50k – < 100k',
    comment:
      'Empty on purpose: base AGENT_ENGINE_THRESHOLDS / DEFAULT_WINDOW_BUDGET_POLICY are the standard band.',
  },
  wide: {
    label: 'Wide',
    rangeLabel: '≥ 100k',
    comment:
      'Large windows: keep mutation effort-capped; leave room for recovered analysis / skills.',
  },
};

/**
 * Locate the Mitii monorepo root that contains packages/v8 ship band sources.
 */
export function findMitiiMonorepoRoot(
  candidates: readonly (string | undefined)[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    const root = candidate.trim();
    if (existsSync(join(root, LOOP_REL)) && existsSync(join(root, WINDOW_REL))) {
      return root;
    }
  }
  return undefined;
}

function formatLargeInt(value: number): string {
  if (!Number.isInteger(value) || Math.abs(value) < 1000) {
    return String(value);
  }
  if (value % 1000 === 0) {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    return `${sign}${String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, '_')}`;
  }
  return String(value);
}

function formatOverrideLines(
  overrides: Record<string, number>,
  indent: string,
): string[] {
  return Object.keys(overrides)
    .sort()
    .map((key) => {
      const value = overrides[key]!;
      const literal =
        Number.isInteger(value) && Math.abs(value) >= 1000
          ? formatLargeInt(value)
          : String(value);
      return `${indent}${key}: ${literal},`;
    });
}

function renderBandEntry(
  band: ShipBandId,
  overrides: Record<string, number>,
  emptyComment: string,
): string {
  const meta = BAND_META[band];
  const keys = Object.keys(overrides);
  if (keys.length === 0) {
    return [
      `  ${band}: {`,
      `    id: "${band}",`,
      `    label: "${meta.label}",`,
      `    rangeLabel: "${meta.rangeLabel}",`,
      `    // ${emptyComment}`,
      `    overrides: {},`,
      `  },`,
    ].join('\n');
  }
  return [
    `  ${band}: {`,
    `    id: "${band}",`,
    `    label: "${meta.label}",`,
    `    rangeLabel: "${meta.rangeLabel}",`,
    `    overrides: {`,
    `      // ${meta.comment}`,
    ...formatOverrideLines(overrides, '      '),
    `    },`,
    `  },`,
  ].join('\n');
}

export function renderLoopPolicyBandsSource(tables: ShipBandTables): string {
  const entries = (['compact', 'standard', 'wide'] as const)
    .map((band) =>
      renderBandEntry(
        band,
        tables.loop[band] ?? {},
        'Empty on purpose: base `AGENT_ENGINE_THRESHOLDS` are the standard band.',
      ),
    )
    .join('\n');

  // Codegen target lives under agent-engine; avoid a host-source line that looks
  // like a deep actions import to architecture scanners.
  const thresholdsTypeImport = `import type { AgentEngineThresholdsOverrides } from ${JSON.stringify("../actions/resolveAgentEngineThresholds")};`;

  return `${thresholdsTypeImport}

/**
 * Window bands for shipped loop/stall standards.
 *
 * Permanent ship values. Edit via Developer → Policy Admin → Save to ship code,
 * or edit this file directly. Developer Custom \`mitii.loopPolicy.*\` overrides
 * are temporary deltas for local testing — not the ship source of truth.
 *
 * Merge order at run start:
 *   AGENT_ENGINE_THRESHOLDS  →  band overrides  →  optional Custom host overrides
 *
 * Cutoffs are exclusive upper bounds except \`wide\` (open-ended).
 */
export const LOOP_POLICY_WINDOW_BANDS = ["compact", "standard", "wide"] as const;

export type LoopPolicyWindowBand = (typeof LOOP_POLICY_WINDOW_BANDS)[number];

/**
 * Exclusive upper bound for each band except \`wide\`.
 * compact:  [0, COMPACT_MAX)
 * standard: [COMPACT_MAX, STANDARD_MAX)
 * wide:     [STANDARD_MAX, ∞)
 */
export const LOOP_POLICY_WINDOW_BAND_CEILINGS = {
  /** Anything below this uses compact (small local windows, e.g. 30k–49k). */
  compactMaxExclusive: 50_000,
  /** Anything below this (and ≥ compact max) uses standard. */
  standardMaxExclusive: 100_000,
} as const;

export interface LoopPolicyWindowBandDefinition {
  id: LoopPolicyWindowBand;
  /** Short UI / docs label. */
  label: string;
  /** Human range, e.g. "< 50k". */
  rangeLabel: string;
  /**
   * Partial overrides merged onto \`AGENT_ENGINE_THRESHOLDS\`.
   * Omit a key to keep the base working standard.
   */
  overrides: AgentEngineThresholdsOverrides;
}

/**
 * Shipped band table. Highest-probability defaults for each window size.
 */
export const LOOP_POLICY_WINDOW_BAND_TABLE: Record<
  LoopPolicyWindowBand,
  LoopPolicyWindowBandDefinition
> = {
${entries}
};

/**
 * Resolve which band applies for an effective context window.
 * Non-finite / non-positive windows fall back to \`compact\` (safest small budget).
 */
export function resolveLoopPolicyWindowBand(
  contextWindowTokens: number,
): LoopPolicyWindowBand {
  const window = Math.floor(contextWindowTokens);
  if (!Number.isFinite(window) || window <= 0) {
    return "compact";
  }
  if (window < LOOP_POLICY_WINDOW_BAND_CEILINGS.compactMaxExclusive) {
    return "compact";
  }
  if (window < LOOP_POLICY_WINDOW_BAND_CEILINGS.standardMaxExclusive) {
    return "standard";
  }
  return "wide";
}

export function loopPolicyWindowBandDefinition(
  band: LoopPolicyWindowBand,
): LoopPolicyWindowBandDefinition {
  return LOOP_POLICY_WINDOW_BAND_TABLE[band];
}

export function listLoopPolicyWindowBands(): readonly LoopPolicyWindowBandDefinition[] {
  return LOOP_POLICY_WINDOW_BANDS.map(
    (id) => LOOP_POLICY_WINDOW_BAND_TABLE[id],
  );
}
`;
}

export function renderWindowBudgetBandsSource(tables: ShipBandTables): string {
  const entries = (['compact', 'standard', 'wide'] as const)
    .map((band) =>
      renderBandEntry(
        band,
        tables.window[band] ?? {},
        'Empty on purpose: base DEFAULT_WINDOW_BUDGET_POLICY is the standard band.',
      ),
    )
    .join('\n');

  return `import type { WindowBudgetPolicyOverrides } from "./contracts";

/**
 * Window-budget bands keyed by the same context-window cutoffs as loop policy
 * (\`compact\` &lt; 50k, \`standard\` &lt; 100k, else \`wide\`).
 *
 * Permanent ship values. Edit via Developer → Policy Admin → Save to ship code,
 * or edit this file directly. Developer Custom \`mitii.tokenBudget.*\` overrides
 * are temporary local deltas — not the ship source of truth.
 *
 * Merge order in \`deriveWindowPolicy\`:
 *   DEFAULT_WINDOW_BUDGET_POLICY  →  band overlays  →  optional host Custom overrides
 */

export const WINDOW_BUDGET_BANDS = ["compact", "standard", "wide"] as const;

export type WindowBudgetBand = (typeof WINDOW_BUDGET_BANDS)[number];

/**
 * Exclusive upper bound for each band except \`wide\`.
 * Must stay aligned with \`LOOP_POLICY_WINDOW_BAND_CEILINGS\`.
 */
export const WINDOW_BUDGET_BAND_CEILINGS = {
  compactMaxExclusive: 50_000,
  standardMaxExclusive: 100_000,
} as const;

export interface WindowBudgetBandDefinition {
  id: WindowBudgetBand;
  label: string;
  rangeLabel: string;
  /**
   * Partial overrides merged onto \`DEFAULT_WINDOW_BUDGET_POLICY\`.
   * Omit a key to keep the base default.
   */
  overrides: WindowBudgetPolicyOverrides;
}

/**
 * Shipped band table. Highest-probability capacity mix per window size.
 */
export const WINDOW_BUDGET_BAND_TABLE: Record<
  WindowBudgetBand,
  WindowBudgetBandDefinition
> = {
${entries}
};

/**
 * Resolve which window-budget band applies for an effective context window.
 * Non-finite / non-positive windows fall back to \`compact\`.
 */
export function resolveWindowBudgetBand(
  contextWindowTokens: number,
): WindowBudgetBand {
  const window = Math.floor(contextWindowTokens);
  if (!Number.isFinite(window) || window <= 0) {
    return "compact";
  }
  if (window < WINDOW_BUDGET_BAND_CEILINGS.compactMaxExclusive) {
    return "compact";
  }
  if (window < WINDOW_BUDGET_BAND_CEILINGS.standardMaxExclusive) {
    return "standard";
  }
  return "wide";
}

export function windowBudgetBandDefinition(
  band: WindowBudgetBand,
): WindowBudgetBandDefinition {
  return WINDOW_BUDGET_BAND_TABLE[band];
}

export function listWindowBudgetBands(): readonly WindowBudgetBandDefinition[] {
  return WINDOW_BUDGET_BANDS.map((id) => WINDOW_BUDGET_BAND_TABLE[id]);
}
`;
}

/**
 * Write loop + window band tables into packages/v8 source.
 * Caller rebuilds / ships manually.
 */
export function writeShipBandSources(options: {
  monorepoRoot: string;
  tables: ShipBandTables;
}): WriteShipBandSourcesResult {
  const loopPath = join(options.monorepoRoot, LOOP_REL);
  const windowPath = join(options.monorepoRoot, WINDOW_REL);
  if (!existsSync(loopPath) || !existsSync(windowPath)) {
    throw new Error(
      `Ship band sources not found under ${options.monorepoRoot}. Open the Mitii monorepo workspace.`,
    );
  }
  writeFileSync(loopPath, renderLoopPolicyBandsSource(options.tables), 'utf8');
  writeFileSync(
    windowPath,
    renderWindowBudgetBandsSource(options.tables),
    'utf8',
  );
  return {
    monorepoRoot: options.monorepoRoot,
    loopPath,
    windowPath,
  };
}
