import { findLocalModelPreset } from './modelPresets.js';
import { TOKEN_BUDGET_FIELDS } from './tokenBudgetSettings.js';
import { LOOP_POLICY_FIELDS } from './loopPolicySettings.js';
import {
  DEFAULT_CONTEXT_WINDOW,
  clampMaximumOutputTokensToContext,
  inferContextWindowFromModelId,
  inferMaximumOutputTokensFromModelId,
  resolveEffectiveContextWindow as resolveHostEffectiveContextWindow,
} from '@mitii/host';
import type {
  ContextToggles,
  ModeDefaultSettingsSnapshot,
  ProviderSettingsSnapshot,
  RunBudgetSettingsSnapshot,
  SettingsTab,
  UiSettingsPatch,
  UiSettingsSnapshot,
} from './protocol.js';
import { SETTINGS_FIELDS_CORE } from './settingsCatalog.js';
import type { SettingsFieldSpec } from './settingsFieldSpec.js';

export type { SettingsFieldSpec, SettingsPage } from './settingsFieldSpec.js';
export {
  DEFAULT_CONTEXT_WINDOW,
  clampMaximumOutputTokensToContext,
  inferContextWindowFromModelId,
  inferMaximumOutputTokensFromModelId,
};

/**
 * Effective context window: settings value wins when positive.
 * Auto (0) uses VS Code local model presets, then shared host inference.
 */
export function resolveEffectiveContextWindow(
  stored: number,
  model: string,
  providerType?: string,
): number {
  if (stored > 0) return Math.floor(stored);
  const preset = findLocalModelPreset(model)?.contextWindow;
  if (typeof preset === 'number' && preset > 0) return preset;
  return resolveHostEffectiveContextWindow(0, model, providerType);
}

export const SETTINGS_NAV_COMPACT_MAX_WIDTH = 440;

export const SETTINGS_NAV_ITEMS: readonly {
  id: SettingsTab;
  label: string;
}[] = [
  { id: 'model', label: 'Provider' },
  { id: 'autocomplete', label: 'Autocomplete' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'modes', label: 'Modes' },
  { id: 'context', label: 'Context' },
  { id: 'features', label: 'Features' },
  { id: 'integrations', label: 'MCP' },
  { id: 'debug', label: 'Developer' },
];

export function isSettingsNavCompact(width: number): boolean {
  return Number.isFinite(width) && width <= SETTINGS_NAV_COMPACT_MAX_WIDTH;
}

export function settingsIconTooltip(
  label: string,
  compact: boolean,
): string | undefined {
  const text = label.trim();
  if (!compact || !text) return undefined;
  return text;
}

export function shouldPostWebviewReady(alreadySent: boolean): boolean {
  return alreadySent !== true;
}

export function tokenLimitDraftAfterHostEcho(options: {
  focused: boolean;
  draftContextWindow: number;
  draftMaxOutput: number;
  storedContextWindow: number;
  storedMaxOutput: number;
}): { contextWindow: number; maximumOutputTokens: number } {
  if (options.focused) {
    return {
      contextWindow: options.draftContextWindow,
      maximumOutputTokens: options.draftMaxOutput,
    };
  }
  return {
    contextWindow: options.storedContextWindow,
    maximumOutputTokens: options.storedMaxOutput,
  };
}

export function parseNumberFieldDraft(
  draft: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  if (!draft.trim()) return undefined;
  const parsed = Number(draft);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = options.integer === false ? parsed : Math.floor(parsed);
  return Math.max(
    options.min ?? Number.NEGATIVE_INFINITY,
    Math.min(options.max ?? Number.POSITIVE_INFINITY, rounded),
  );
}

/** Historical VS Code default; treated as unset so output scales with the window. */
export const LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS = 5_000;

export function normalizeTokenLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** Map the legacy 5000 default to 0 (auto / derive from context window). */
export function normalizeMaximumOutputTokens(raw: unknown): number {
  const value = normalizeTokenLimit(raw);
  return value === LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS ? 0 : value;
}

export function isAutoMaximumOutputTokens(raw: unknown): boolean {
  return normalizeMaximumOutputTokens(raw) === 0;
}

export function normalizePositiveInt(raw: unknown, fallback: number, min = 1): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

export function readStoredContextWindow(raw: unknown): number {
  return normalizeTokenLimit(raw);
}

export function applyProviderTokenLimits(
  current: Pick<ProviderSettingsSnapshot, 'contextWindow' | 'maximumOutputTokens'>,
  patch: Partial<Pick<ProviderSettingsSnapshot, 'contextWindow' | 'maximumOutputTokens'>>,
): Pick<ProviderSettingsSnapshot, 'contextWindow' | 'maximumOutputTokens'> {
  return {
    contextWindow:
      patch.contextWindow === undefined
        ? current.contextWindow
        : normalizeTokenLimit(patch.contextWindow),
    maximumOutputTokens:
      patch.maximumOutputTokens === undefined
        ? current.maximumOutputTokens
        : normalizeMaximumOutputTokens(patch.maximumOutputTokens),
  };
}

export function reflectProviderTokenLimits(stored: {
  contextWindow: number;
  maximumOutputTokens: number;
  model: string;
}): {
  contextWindow: number;
  maximumOutputTokens: number;
  effectiveContextWindow: number;
} {
  const contextWindow = normalizeTokenLimit(stored.contextWindow);
  const maximumOutputTokens = normalizeMaximumOutputTokens(
    stored.maximumOutputTokens,
  );
  return {
    contextWindow,
    maximumOutputTokens,
    effectiveContextWindow: resolveEffectiveContextWindow(
      contextWindow,
      stored.model,
    ),
  };
}

export function applyProviderPatch(
  current: ProviderSettingsSnapshot,
  patch: Partial<
    Pick<
      ProviderSettingsSnapshot,
      | 'type'
      | 'preset'
      | 'baseUrl'
      | 'model'
      | 'contextWindow'
      | 'maximumOutputTokens'
    >
  >,
): ProviderSettingsSnapshot {
  const tokens = applyProviderTokenLimits(current, patch);
  return {
    ...current,
    ...patch,
    ...tokens,
    effectiveContextWindow: resolveEffectiveContextWindow(
      tokens.contextWindow,
      patch.model ?? current.model,
    ),
  };
}

export function applyUiPatch(
  base: UiSettingsSnapshot,
  patch: UiSettingsPatch,
): UiSettingsSnapshot {
  const { features: _features, ...restPatch } = patch;
  return {
    ...base,
    ...restPatch,
    features: patch.features
      ? { ...base.features, ...patch.features }
      : base.features,
    contextToggles: patch.contextToggles
      ? { ...base.contextToggles, ...patch.contextToggles }
      : base.contextToggles,
    modeDefaults: patch.modeDefaults
      ? {
          ...base.modeDefaults,
          ask: { ...base.modeDefaults.ask, ...patch.modeDefaults.ask },
          plan: { ...base.modeDefaults.plan, ...patch.modeDefaults.plan },
          agent: { ...base.modeDefaults.agent, ...patch.modeDefaults.agent },
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

export function reflectUiAfterSave(stored: UiSettingsSnapshot): UiSettingsSnapshot {
  return {
    ...stored,
    reasoningPreviewMaxChars: normalizePositiveInt(
      stored.reasoningPreviewMaxChars,
      8000,
      500,
    ),
    runBudget: {
      unlimited: stored.runBudget.unlimited === true,
      maxModelCalls: normalizePositiveInt(stored.runBudget.maxModelCalls, 64),
      maxToolCalls: normalizePositiveInt(stored.runBudget.maxToolCalls, 128),
      maxLoopIterations: normalizePositiveInt(
        stored.runBudget.maxLoopIterations,
        96,
      ),
      maxWallTimeMinutes: normalizePositiveInt(
        stored.runBudget.maxWallTimeMinutes,
        30,
      ),
    },
  };
}

/**
 * Keep the active chat mode's approval preset aligned with the composer value
 * before persisting. Otherwise Save can write a stale modeDefaults.approvalMode
 * (Agent defaults to `safe`) and overwrite Full access after reload.
 */
export function withActiveModeApproval(params: {
  ui: UiSettingsSnapshot;
  mode: 'ask' | 'plan' | 'agent' | 'review';
  approvalMode: string;
}): UiSettingsSnapshot {
  const settingsMode =
    params.mode === 'plan' || params.mode === 'agent' ? params.mode : 'ask';
  const approvalMode =
    params.approvalMode === 'builder' ? 'guided' : params.approvalMode;
  return applyUiPatch(params.ui, {
    approvalMode,
    modeDefaults: {
      [settingsMode]: { approvalMode },
    },
  });
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

export function applyTokenBudgetPolicyField(
  policy: Record<string, number>,
  key: string,
  raw: unknown,
): Record<string, number> {
  const field = TOKEN_BUDGET_FIELDS.find((entry) => entry.key === key);
  if (!field) return policy;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return policy;
  const bounded = Math.max(
    field.min,
    Math.min(field.max ?? Number.POSITIVE_INFINITY, parsed),
  );
  return {
    ...policy,
    [key]: field.kind === 'int' ? Math.floor(bounded) : bounded,
  };
}

export const DEFAULT_CONTEXT_TOGGLES: ContextToggles = {
  repoMap: false,
  diagnostics: true,
  gitDiff: false,
  editor: true,
  openTabs: false,
  memory: true,
};

export const DEFAULT_RUN_BUDGET: RunBudgetSettingsSnapshot = {
  unlimited: false,
  maxModelCalls: 64,
  maxToolCalls: 128,
  maxLoopIterations: 96,
  maxWallTimeMinutes: 30,
};

export const DEFAULT_MODE_DEFAULTS: Record<
  'ask' | 'plan' | 'agent',
  ModeDefaultSettingsSnapshot
> = {
  ask: {
    thoroughness: 'medium',
    depth: 'auto',
    approvalMode: 'guided',
    model: '',
  },
  plan: {
    thoroughness: 'high',
    depth: 'deep',
    approvalMode: 'guided',
    model: '',
  },
  agent: {
    thoroughness: 'medium',
    depth: 'auto',
    approvalMode: 'safe',
    model: '',
  },
};


export const SETTINGS_FIELDS: readonly SettingsFieldSpec[] = [
  ...SETTINGS_FIELDS_CORE,
  ...TOKEN_BUDGET_FIELDS.filter((field) => !field.hiddenFromDebug).map(
    (field) =>
      ({
        id: `tokenBudget.${field.key}`,
        page: 'developer',
        tab: 'debug',
        setting: `tokenBudget.${field.key}`,
        label: field.label,
        kind: field.kind === 'int' ? 'int' : 'number',
        reflect: 'raw',
        sample:
          field.kind === 'ratio'
            ? Math.min(field.max ?? 1, Math.max(field.min, 0.2))
            : Math.max(field.min, field.step),
        min: field.min,
        max: field.max,
      }) satisfies SettingsFieldSpec,
  ),
  {
    id: 'loopPolicy.enabled',
    page: 'developer',
    tab: 'debug',
    setting: 'loopPolicy.enabled',
    label: 'Custom loop policy',
    kind: 'boolean',
    reflect: 'raw',
    sample: true,
  },
  ...LOOP_POLICY_FIELDS.map(
    (field) =>
      ({
        id: `loopPolicy.${field.key}`,
        page: 'developer',
        tab: 'debug',
        setting: `loopPolicy.${field.key}`,
        label: field.label,
        kind: field.kind === 'int' ? 'int' : 'number',
        reflect: 'raw',
        sample:
          field.kind === 'ratio'
            ? Math.min(field.max ?? 1, Math.max(field.min, 0.2))
            : Math.max(field.min, field.step),
        min: field.min,
        max: field.max,
      }) satisfies SettingsFieldSpec,
  ),
];
