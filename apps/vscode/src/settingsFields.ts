import { findLocalModelPreset } from './modelPresets.js';
import { TOKEN_BUDGET_FIELDS } from './tokenBudgetSettings.js';
import { LOOP_POLICY_FIELDS } from './loopPolicySettings.js';
import type {
  ContextToggles,
  ModeDefaultSettingsSnapshot,
  ProviderSettingsSnapshot,
  RunBudgetSettingsSnapshot,
  SettingsTab,
  UiSettingsPatch,
  UiSettingsSnapshot,
} from './protocol.js';

export const DEFAULT_CONTEXT_WINDOW = 32_768;
export const SETTINGS_NAV_COMPACT_MAX_WIDTH = 440;

export const SETTINGS_NAV_ITEMS: readonly {
  id: SettingsTab;
  label: string;
}[] = [
  { id: 'model', label: 'Provider' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'modes', label: 'Modes' },
  { id: 'context', label: 'Context' },
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

export type SettingsPage =
  | 'provider'
  | 'workspace'
  | 'modes'
  | 'context'
  | 'mcp'
  | 'developer';

export interface SettingsFieldSpec {
  id: string;
  page: SettingsPage;
  tab: SettingsTab;
  setting: string;
  label: string;
  kind: 'string' | 'int' | 'number' | 'boolean' | 'enum';
  /** Value the settings UI must show after save (raw stored value). */
  reflect: 'raw' | 'effective';
  sample: unknown;
  min?: number;
  max?: number;
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

export function normalizeTokenLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function normalizePositiveInt(raw: unknown, fallback: number, min = 1): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

export function resolveEffectiveContextWindow(
  stored: number,
  model: string,
): number {
  if (stored > 0) return stored;
  return findLocalModelPreset(model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
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
        : normalizeTokenLimit(patch.maximumOutputTokens),
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
  const maximumOutputTokens = normalizeTokenLimit(stored.maximumOutputTokens);
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
  return {
    ...base,
    ...patch,
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
  repoMap: true,
  diagnostics: true,
  gitDiff: true,
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
  {
    id: 'provider.type',
    page: 'provider',
    tab: 'model',
    setting: 'provider.type',
    label: 'Provider adapter',
    kind: 'enum',
    reflect: 'raw',
    sample: 'openai-compatible',
  },
  {
    id: 'provider.preset',
    page: 'provider',
    tab: 'model',
    setting: 'provider.preset',
    label: 'Provider',
    kind: 'enum',
    reflect: 'raw',
    sample: 'ollama',
  },
  {
    id: 'provider.baseUrl',
    page: 'provider',
    tab: 'model',
    setting: 'provider.baseUrl',
    label: 'Base URL',
    kind: 'string',
    reflect: 'raw',
    sample: 'http://localhost:11434/v1',
  },
  {
    id: 'provider.model',
    page: 'provider',
    tab: 'model',
    setting: 'provider.model',
    label: 'Model',
    kind: 'string',
    reflect: 'raw',
    sample: 'qwen3-coder:30b',
  },
  {
    id: 'provider.contextWindow',
    page: 'provider',
    tab: 'model',
    setting: 'provider.contextWindow',
    label: 'Context window',
    kind: 'int',
    reflect: 'raw',
    sample: 8192,
    min: 0,
  },
  {
    id: 'provider.maximumOutputTokens',
    page: 'provider',
    tab: 'model',
    setting: 'provider.maximumOutputTokens',
    label: 'Max output',
    kind: 'int',
    reflect: 'raw',
    sample: 2048,
    min: 0,
  },
  {
    id: 'workspace.rootPathOverride',
    page: 'workspace',
    tab: 'workspace',
    setting: 'workspace.rootPathOverride',
    label: 'Root path override',
    kind: 'string',
    reflect: 'raw',
    sample: '/tmp/mitii-workspace',
  },
  {
    id: 'workspace.maximumIndexFiles',
    page: 'workspace',
    tab: 'workspace',
    setting: 'workspace.maximumIndexFiles',
    label: 'Maximum index files',
    kind: 'int',
    reflect: 'raw',
    sample: 30000,
    min: 0,
    max: 240000,
  },
  {
    id: 'semanticIndex.source',
    page: 'workspace',
    tab: 'workspace',
    setting: 'semanticIndex.source',
    label: 'Embedding source',
    kind: 'enum',
    reflect: 'raw',
    sample: 'disabled',
  },
  {
    id: 'semanticIndex.backend',
    page: 'workspace',
    tab: 'workspace',
    setting: 'semanticIndex.backend',
    label: 'Embedding backend',
    kind: 'enum',
    reflect: 'raw',
    sample: 'disabled',
  },
  {
    id: 'semanticIndex.enabled',
    page: 'workspace',
    tab: 'workspace',
    setting: 'semanticIndex.enabled',
    label: 'Semantic indexing enabled',
    kind: 'boolean',
    reflect: 'raw',
    sample: false,
  },
  {
    id: 'ui.modeDefaults.ask.thoroughness',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.modeDefaults.ask.thoroughness',
    label: 'Ask thoroughness',
    kind: 'enum',
    reflect: 'raw',
    sample: 'medium',
  },
  {
    id: 'ui.modeDefaults.plan.thoroughness',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.modeDefaults.plan.thoroughness',
    label: 'Plan thoroughness',
    kind: 'enum',
    reflect: 'raw',
    sample: 'high',
  },
  {
    id: 'ui.modeDefaults.agent.thoroughness',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.modeDefaults.agent.thoroughness',
    label: 'Agent thoroughness',
    kind: 'enum',
    reflect: 'raw',
    sample: 'medium',
  },
  {
    id: 'ui.modeDefaults.ask.approvalMode',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.modeDefaults.ask.approvalMode',
    label: 'Ask approval',
    kind: 'enum',
    reflect: 'raw',
    sample: 'safe',
  },
  {
    id: 'ui.modeDefaults.plan.approvalMode',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.modeDefaults.plan.approvalMode',
    label: 'Plan approval',
    kind: 'enum',
    reflect: 'raw',
    sample: 'guided',
  },
  {
    id: 'ui.modeDefaults.agent.approvalMode',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.modeDefaults.agent.approvalMode',
    label: 'Agent approval',
    kind: 'enum',
    reflect: 'raw',
    sample: 'pilot',
  },
  {
    id: 'ui.modeDefaults.ask.model',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.modeDefaults.ask.model',
    label: 'Ask model',
    kind: 'string',
    reflect: 'raw',
    sample: 'qwen3.5:9b',
  },
  {
    id: 'ui.modeDefaults.plan.model',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.modeDefaults.plan.model',
    label: 'Plan model',
    kind: 'string',
    reflect: 'raw',
    sample: 'qwen3-coder:30b',
  },
  {
    id: 'ui.modeDefaults.agent.model',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.modeDefaults.agent.model',
    label: 'Agent model',
    kind: 'string',
    reflect: 'raw',
    sample: 'qwen3.5:latest',
  },
  {
    id: 'developer.intensityOverrides',
    page: 'developer',
    tab: 'debug',
    setting: 'developer.intensityOverrides',
    label: 'Intensity overrides',
    kind: 'boolean',
    reflect: 'raw',
    sample: true,
  },
  {
    id: 'ui.effort',
    page: 'developer',
    tab: 'debug',
    setting: 'ui.effort',
    label: 'Working set (override)',
    kind: 'enum',
    reflect: 'raw',
    sample: 'high',
  },
  {
    id: 'ui.modeDefaults.ask.depth',
    page: 'developer',
    tab: 'debug',
    setting: 'ui.modeDefaults.ask.depth',
    label: 'Ask depth (override)',
    kind: 'enum',
    reflect: 'raw',
    sample: 'quick',
  },
  {
    id: 'ui.modeDefaults.plan.depth',
    page: 'developer',
    tab: 'debug',
    setting: 'ui.modeDefaults.plan.depth',
    label: 'Plan depth (override)',
    kind: 'enum',
    reflect: 'raw',
    sample: 'deep',
  },
  {
    id: 'ui.modeDefaults.agent.depth',
    page: 'developer',
    tab: 'debug',
    setting: 'ui.modeDefaults.agent.depth',
    label: 'Agent depth (override)',
    kind: 'enum',
    reflect: 'raw',
    sample: 'auto',
  },
  {
    id: 'ui.showReasoning',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.showReasoning',
    label: 'Show reasoning stream',
    kind: 'boolean',
    reflect: 'raw',
    sample: false,
  },
  {
    id: 'ui.reasoningPreviewMaxChars',
    page: 'modes',
    tab: 'modes',
    setting: 'ui.reasoningPreviewMaxChars',
    label: 'Reasoning preview chars',
    kind: 'int',
    reflect: 'raw',
    sample: 4000,
    min: 500,
    max: 50_000,
  },
  {
    id: 'runBudget.unlimited',
    page: 'modes',
    tab: 'modes',
    setting: 'runBudget.unlimited',
    label: 'Unlimited run budget',
    kind: 'boolean',
    reflect: 'raw',
    sample: true,
  },
  {
    id: 'runBudget.maxModelCalls',
    page: 'modes',
    tab: 'modes',
    setting: 'runBudget.maxModelCalls',
    label: 'Model calls',
    kind: 'int',
    reflect: 'raw',
    sample: 12,
    min: 1,
  },
  {
    id: 'runBudget.maxToolCalls',
    page: 'modes',
    tab: 'modes',
    setting: 'runBudget.maxToolCalls',
    label: 'Tool calls',
    kind: 'int',
    reflect: 'raw',
    sample: 24,
    min: 1,
  },
  {
    id: 'runBudget.maxLoopIterations',
    page: 'modes',
    tab: 'modes',
    setting: 'runBudget.maxLoopIterations',
    label: 'Loop iterations',
    kind: 'int',
    reflect: 'raw',
    sample: 40,
    min: 1,
  },
  {
    id: 'runBudget.maxWallTimeMinutes',
    page: 'modes',
    tab: 'modes',
    setting: 'runBudget.maxWallTimeMinutes',
    label: 'Wall time (min)',
    kind: 'int',
    reflect: 'raw',
    sample: 15,
    min: 1,
  },
  {
    id: 'ui.contextToggles.repoMap',
    page: 'context',
    tab: 'context',
    setting: 'ui.contextToggles.repoMap',
    label: 'Repo map',
    kind: 'boolean',
    reflect: 'raw',
    sample: false,
  },
  {
    id: 'ui.contextToggles.diagnostics',
    page: 'context',
    tab: 'context',
    setting: 'ui.contextToggles.diagnostics',
    label: 'Diagnostics',
    kind: 'boolean',
    reflect: 'raw',
    sample: false,
  },
  {
    id: 'ui.contextToggles.gitDiff',
    page: 'context',
    tab: 'context',
    setting: 'ui.contextToggles.gitDiff',
    label: 'Git diff',
    kind: 'boolean',
    reflect: 'raw',
    sample: false,
  },
  {
    id: 'ui.contextToggles.editor',
    page: 'context',
    tab: 'context',
    setting: 'ui.contextToggles.editor',
    label: 'Active editor',
    kind: 'boolean',
    reflect: 'raw',
    sample: false,
  },
  {
    id: 'ui.contextToggles.openTabs',
    page: 'context',
    tab: 'context',
    setting: 'ui.contextToggles.openTabs',
    label: 'Open tabs',
    kind: 'boolean',
    reflect: 'raw',
    sample: true,
  },
  {
    id: 'ui.contextToggles.memory',
    page: 'context',
    tab: 'context',
    setting: 'ui.contextToggles.memory',
    label: 'Memory',
    kind: 'boolean',
    reflect: 'raw',
    sample: false,
  },
  {
    id: 'mcp.enabled',
    page: 'mcp',
    tab: 'integrations',
    setting: 'mcp.enabled',
    label: 'Enable MCP',
    kind: 'boolean',
    reflect: 'raw',
    sample: true,
  },
  {
    id: 'developer.enabled',
    page: 'developer',
    tab: 'debug',
    setting: 'developer.enabled',
    label: 'Enable developer settings',
    kind: 'boolean',
    reflect: 'raw',
    sample: true,
  },
  {
    id: 'debug',
    page: 'developer',
    tab: 'debug',
    setting: 'debug',
    label: 'Debug logging',
    kind: 'boolean',
    reflect: 'raw',
    sample: true,
  },
  {
    id: 'developer.modelIo',
    page: 'developer',
    tab: 'debug',
    setting: 'developer.modelIo',
    label: 'Log model I/O',
    kind: 'boolean',
    reflect: 'raw',
    sample: true,
  },
  {
    id: 'tokenBudget.enabled',
    page: 'developer',
    tab: 'debug',
    setting: 'tokenBudget.enabled',
    label: 'Custom token budget',
    kind: 'boolean',
    reflect: 'raw',
    sample: true,
  },
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
