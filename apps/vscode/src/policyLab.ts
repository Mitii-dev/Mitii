import { resolve as resolvePath, join } from 'node:path';

import {
  AGENT_ENGINE_THRESHOLDS,
  DEFAULT_WINDOW_BUDGET_POLICY,
  LOOP_POLICY_WINDOW_BAND_TABLE,
  WINDOW_BUDGET_BAND_TABLE,
  listWindowBudgetBands,
  loopPolicyWindowBandDefinition,
  resolveWindowBudgetBand,
  type WindowBudgetBand,
} from '@mitii/sdk';

import { LOOP_POLICY_FIELDS } from './loopPolicySettings.js';
import type {
  PolicyLabSettingsSnapshot,
  TokenBudgetFieldDescriptor,
} from './protocol.js';
import { TOKEN_BUDGET_FIELDS } from './tokenBudgetSettings.js';
import {
  findMitiiMonorepoRoot,
  writeShipBandSources,
  type ShipBandId,
  type ShipBandTables,
} from './writeShipBandSources.js';

function asNumberRecord(value: object): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      next[key] = entry;
    }
  }
  return next;
}

/** Load current shipped band override maps from V8 tables (via SDK). */
export function readShipBandTables(): ShipBandTables {
  const loop: ShipBandTables['loop'] = {
    compact: {},
    standard: {},
    wide: {},
  };
  const window: ShipBandTables['window'] = {
    compact: {},
    standard: {},
    wide: {},
  };
  for (const band of ['compact', 'standard', 'wide'] as const) {
    loop[band] = asNumberRecord(LOOP_POLICY_WINDOW_BAND_TABLE[band].overrides);
    window[band] = asNumberRecord(WINDOW_BUDGET_BAND_TABLE[band].overrides);
  }
  return { loop, window };
}

/**
 * Snapshot for Developer → Policy Admin (edits ship band tables in source).
 */
export function readPolicyLabSettings(
  contextWindowTokens: number,
  editBand?: WindowBudgetBand,
  draftTables?: ShipBandTables,
): PolicyLabSettingsSnapshot {
  const ship = draftTables ?? readShipBandTables();
  const bandId = resolveWindowBudgetBand(contextWindowTokens);
  const bandDef = WINDOW_BUDGET_BAND_TABLE[bandId];
  const loopBandDef = loopPolicyWindowBandDefinition(bandId);
  const selected = editBand ?? bandId;

  const loopOverrides = { ...(ship.loop[selected] ?? {}) };
  const windowOverrides = { ...(ship.window[selected] ?? {}) };

  const loopThresholds = {
    ...asNumberRecord(AGENT_ENGINE_THRESHOLDS),
    ...loopOverrides,
  };
  const windowPolicy = {
    ...asNumberRecord(DEFAULT_WINDOW_BUDGET_POLICY),
    ...windowOverrides,
  };

  return {
    enabled: false,
    filePath:
      'packages/v8/.../loopPolicyBands.ts + windowBudgetBands.ts',
    exists: true,
    previewContextWindowTokens: contextWindowTokens,
    activeBand: {
      id: bandId,
      label: bandDef.label,
      rangeLabel: bandDef.rangeLabel,
      contextWindowTokens,
    },
    editBand: selected,
    bands: listWindowBudgetBands().map(
      (entry: { id: WindowBudgetBand; label: string; rangeLabel: string }) => ({
        id: entry.id,
        label: entry.label,
        rangeLabel: entry.rangeLabel,
      }),
    ),
    loopByBand: {
      compact: { ...(ship.loop.compact ?? {}) },
      standard: { ...(ship.loop.standard ?? {}) },
      wide: { ...(ship.loop.wide ?? {}) },
    },
    windowByBand: {
      compact: { ...(ship.window.compact ?? {}) },
      standard: { ...(ship.window.standard ?? {}) },
      wide: { ...(ship.window.wide ?? {}) },
    },
    loopOverrides,
    windowOverrides,
    loopThresholds,
    loopBandThresholds: asNumberRecord(AGENT_ENGINE_THRESHOLDS),
    windowPolicy,
    windowBandPolicy: asNumberRecord(DEFAULT_WINDOW_BUDGET_POLICY),
    loopFields: LOOP_POLICY_FIELDS as TokenBudgetFieldDescriptor[],
    windowFields: TOKEN_BUDGET_FIELDS.filter((field) => !field.hiddenFromDebug),
    loopBandHint: `${loopBandDef.label} (${loopBandDef.rangeLabel})`,
    shipPreviewNote:
      'Save writes V8 source. Rebuild @mitii/v8 (and the extension) before runs use the new ship values. Custom loop/token-budget toggles remain optional local deltas only.',
  };
}

export function tablesFromSnapshot(
  snapshot: PolicyLabSettingsSnapshot,
): ShipBandTables {
  const loopByBand: Record<ShipBandId, Record<string, number>> = {
    compact: { ...(snapshot.loopByBand?.compact ?? {}) },
    standard: { ...(snapshot.loopByBand?.standard ?? {}) },
    wide: { ...(snapshot.loopByBand?.wide ?? {}) },
  };
  const windowByBand: Record<ShipBandId, Record<string, number>> = {
    compact: { ...(snapshot.windowByBand?.compact ?? {}) },
    standard: { ...(snapshot.windowByBand?.standard ?? {}) },
    wide: { ...(snapshot.windowByBand?.wide ?? {}) },
  };
  loopByBand[snapshot.editBand] = { ...snapshot.loopOverrides };
  windowByBand[snapshot.editBand] = { ...snapshot.windowOverrides };
  return { loop: loopByBand, window: windowByBand };
}

/**
 * Write Policy Admin draft into V8 ship band source files.
 */
export function saveShipBandsFromUi(options: {
  snapshot: PolicyLabSettingsSnapshot;
  workspaceRoot: string | undefined;
  extensionPath: string | undefined;
}): { loopPath: string; windowPath: string; monorepoRoot: string } {
  const monorepoRoot = findMitiiMonorepoRoot([
    options.workspaceRoot,
    options.extensionPath
      ? resolvePath(join(options.extensionPath, '../..'))
      : undefined,
    options.extensionPath
      ? resolvePath(join(options.extensionPath, '../../..'))
      : undefined,
  ]);
  if (!monorepoRoot) {
    throw new Error(
      'Could not find Mitii monorepo (packages/v8 band sources). Open the mitii-ai-agent repo as the workspace.',
    );
  }
  const tables = tablesFromSnapshot(options.snapshot);
  const baseLoop = asNumberRecord(AGENT_ENGINE_THRESHOLDS);
  const baseWindow = asNumberRecord(DEFAULT_WINDOW_BUDGET_POLICY);
  const cleaned: ShipBandTables = {
    loop: {
      compact: deltasFromBase(tables.loop.compact, baseLoop),
      standard: deltasFromBase(tables.loop.standard, baseLoop),
      wide: deltasFromBase(tables.loop.wide, baseLoop),
    },
    window: {
      compact: deltasFromBase(tables.window.compact, baseWindow),
      standard: deltasFromBase(tables.window.standard, baseWindow),
      wide: deltasFromBase(tables.window.wide, baseWindow),
    },
  };
  return writeShipBandSources({ monorepoRoot, tables: cleaned });
}

function deltasFromBase(
  values: Record<string, number>,
  base: Record<string, number>,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (base[key] === value) continue;
    next[key] = value;
  }
  return next;
}
