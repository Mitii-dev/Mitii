import { type SettingsMode } from '../app/hydrate';
import { DEFAULT_UI } from '../app/uiDefaults';
import { type AgentUiMode, type UiSettingsPatch, type UiSettingsSnapshot } from '../protocol';
import { inferThoroughness, thoroughnessFromDepth } from '@mitii/ui-core';

export function settingsModeFor(mode: AgentUiMode): SettingsMode {
  if (mode === 'plan' || mode === 'agent') return mode;
  return 'ask';
}

export function modeDefaultsFromUi(ui: UiSettingsSnapshot, mode: AgentUiMode) {
  const settingsMode = settingsModeFor(mode);
  const fallback = DEFAULT_UI.modeDefaults[settingsMode];
  const current = ui.modeDefaults?.[settingsMode];
  const depth = current?.depth ?? ui.depth ?? fallback.depth;
  const thoroughness =
    current?.thoroughness ??
    inferThoroughness(depth, ui.effort) ??
    thoroughnessFromDepth(depth) ??
    fallback.thoroughness;
  return {
    thoroughness,
    depth,
    approvalMode:
      current?.approvalMode ?? ui.approvalMode ?? fallback.approvalMode,
    model: current?.model ?? fallback.model,
  };
}

export function mergeUiPatch(
  base: UiSettingsSnapshot,
  patch: UiSettingsPatch,
): UiSettingsSnapshot {
  const {
    contextToggles: _ct,
    modeDefaults: _md,
    runBudget: _rb,
    tokenBudget: _tb,
    loopPolicy: _lp,
    v8LoopPolicy: _v8,
    policyLab: _pl,
    features: _features,
    ...scalarPatch
  } = patch;
  return {
    ...base,
    ...scalarPatch,
    features: patch.features
      ? { ...base.features, ...patch.features }
      : base.features,
    contextToggles: patch.contextToggles
      ? { ...base.contextToggles, ...patch.contextToggles }
      : base.contextToggles,
    modeDefaults: patch.modeDefaults
      ? {
          ...base.modeDefaults,
          ask: {
            ...base.modeDefaults.ask,
            ...patch.modeDefaults.ask,
          },
          plan: {
            ...base.modeDefaults.plan,
            ...patch.modeDefaults.plan,
          },
          agent: {
            ...base.modeDefaults.agent,
            ...patch.modeDefaults.agent,
          },
        }
      : base.modeDefaults,
    runBudget: patch.runBudget
      ? { ...base.runBudget, ...patch.runBudget }
      : base.runBudget,
    tokenBudget: patch.tokenBudget
      ? {
          ...base.tokenBudget,
          ...patch.tokenBudget,
          policy: {
            ...base.tokenBudget.policy,
            ...(patch.tokenBudget.policy ?? {}),
          },
          fields: base.tokenBudget.fields,
          preview: base.tokenBudget.preview,
        }
      : base.tokenBudget,
    loopPolicy: patch.loopPolicy
      ? {
          ...base.loopPolicy,
          ...patch.loopPolicy,
          thresholds: {
            ...base.loopPolicy.thresholds,
            ...(patch.loopPolicy.thresholds ?? {}),
          },
          bandThresholds: {
            ...base.loopPolicy.bandThresholds,
            ...(patch.loopPolicy.bandThresholds ?? {}),
          },
          band: patch.loopPolicy.band ?? base.loopPolicy.band,
          fields: base.loopPolicy.fields,
        }
      : base.loopPolicy,
    v8LoopPolicy: patch.v8LoopPolicy
      ? {
          ...base.v8LoopPolicy,
          ...patch.v8LoopPolicy,
          thresholds: {
            ...base.v8LoopPolicy.thresholds,
            ...(patch.v8LoopPolicy.thresholds ?? {}),
          },
          bandThresholds: {
            ...base.v8LoopPolicy.bandThresholds,
            ...(patch.v8LoopPolicy.bandThresholds ?? {}),
          },
          band: patch.v8LoopPolicy.band ?? base.v8LoopPolicy.band,
          fields: base.v8LoopPolicy.fields,
        }
      : base.v8LoopPolicy,
    policyLab: patch.policyLab
      ? {
          ...base.policyLab,
          ...patch.policyLab,
          loopByBand: {
            compact: {
              ...base.policyLab.loopByBand.compact,
              ...(patch.policyLab.loopByBand?.compact ?? {}),
            },
            standard: {
              ...base.policyLab.loopByBand.standard,
              ...(patch.policyLab.loopByBand?.standard ?? {}),
            },
            wide: {
              ...base.policyLab.loopByBand.wide,
              ...(patch.policyLab.loopByBand?.wide ?? {}),
            },
          },
          windowByBand: {
            compact: {
              ...base.policyLab.windowByBand.compact,
              ...(patch.policyLab.windowByBand?.compact ?? {}),
            },
            standard: {
              ...base.policyLab.windowByBand.standard,
              ...(patch.policyLab.windowByBand?.standard ?? {}),
            },
            wide: {
              ...base.policyLab.windowByBand.wide,
              ...(patch.policyLab.windowByBand?.wide ?? {}),
            },
          },
          loopOverrides: {
            ...base.policyLab.loopOverrides,
            ...(patch.policyLab.loopOverrides ?? {}),
          },
          windowOverrides: {
            ...base.policyLab.windowOverrides,
            ...(patch.policyLab.windowOverrides ?? {}),
          },
          loopThresholds: {
            ...base.policyLab.loopThresholds,
            ...(patch.policyLab.loopThresholds ?? {}),
          },
          windowPolicy: {
            ...base.policyLab.windowPolicy,
            ...(patch.policyLab.windowPolicy ?? {}),
          },
          loopBandThresholds: base.policyLab.loopBandThresholds,
          windowBandPolicy: base.policyLab.windowBandPolicy,
          loopFields: base.policyLab.loopFields,
          windowFields: base.policyLab.windowFields,
          bands: base.policyLab.bands,
          activeBand: patch.policyLab.activeBand ?? base.policyLab.activeBand,
          shipPreviewNote:
            patch.policyLab.shipPreviewNote ?? base.policyLab.shipPreviewNote,
        }
      : base.policyLab,
  };
}

export function clearStaleModeModelDefaultsAfterProviderModelChange(params: {
  ui: UiSettingsSnapshot;
  previousProviderModel: string;
  nextProviderModel: string;
}): UiSettingsSnapshot {
  const previous = params.previousProviderModel.trim();
  const next = params.nextProviderModel.trim();
  if (!previous || previous === next) return params.ui;
  let changed = false;
  const modeDefaults = { ...params.ui.modeDefaults };
  for (const mode of ['ask', 'plan', 'agent'] as const) {
    if ((modeDefaults[mode].model ?? '').trim() !== previous) continue;
    changed = true;
    modeDefaults[mode] = {
      ...modeDefaults[mode],
      model: '',
    };
  }
  return changed ? { ...params.ui, modeDefaults } : params.ui;
}
