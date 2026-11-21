import { type AutocompleteSettingsSnapshot, type ContextToggles, type SearchSettingsSnapshot, type TokenBudgetSettingsSnapshot, type LoopPolicySettingsSnapshot, type PolicyLabSettingsSnapshot, type UiSettingsSnapshot } from '../protocol';
import { deriveLiveTokenBudgetPreview } from '@mitii/ui-core';

export const DEFAULT_CONTEXT_TOGGLES: ContextToggles = {
  repoMap: false,
  diagnostics: true,
  gitDiff: false,
  editor: true,
  openTabs: false,
  memory: true,
};

export const DEFAULT_RUN_BUDGET = {
  unlimited: false,
  maxModelCalls: 64,
  maxToolCalls: 128,
  maxLoopIterations: 96,
  maxWallTimeMinutes: 30,
};

export const DEFAULT_TOKEN_BUDGET: TokenBudgetSettingsSnapshot = {
  enabled: false,
  policy: {},
  fields: [],
  preview: deriveLiveTokenBudgetPreview({
    contextWindowTokens: 32_768,
    runBudget: {
      unlimited: false,
      maxModelCalls: 64,
      maxToolCalls: 128,
    },
  }),
};

export const DEFAULT_LOOP_POLICY: LoopPolicySettingsSnapshot = {
  enabled: false,
  thresholds: {},
  bandThresholds: {},
  band: {
    id: 'compact',
    label: 'Compact',
    rangeLabel: '< 50k',
    contextWindowTokens: 0,
  },
  fields: [],
};

export const DEFAULT_POLICY_LAB: PolicyLabSettingsSnapshot = {
  enabled: false,
  filePath: 'packages/v8/.../loopPolicyBands.ts + windowBudgetBands.ts',
  exists: true,
  previewContextWindowTokens: 35_000,
  activeBand: {
    id: 'compact',
    label: 'Compact',
    rangeLabel: '< 50k',
    contextWindowTokens: 35_000,
  },
  editBand: 'compact',
  bands: [
    { id: 'compact', label: 'Compact', rangeLabel: '< 50k' },
    { id: 'standard', label: 'Standard', rangeLabel: '50k – < 100k' },
    { id: 'wide', label: 'Wide', rangeLabel: '≥ 100k' },
  ],
  loopByBand: { compact: {}, standard: {}, wide: {} },
  windowByBand: { compact: {}, standard: {}, wide: {} },
  loopOverrides: {},
  windowOverrides: {},
  loopThresholds: {},
  loopBandThresholds: {},
  windowPolicy: {},
  windowBandPolicy: {},
  loopFields: [],
  windowFields: [],
  loopBandHint: 'Compact (< 50k)',
  shipPreviewNote:
    'Save writes V8 source. Rebuild before runs use the new ship values.',
};

export const DEFAULT_UI: UiSettingsSnapshot = {
  showReasoning: true,
  reasoningPreviewMaxChars: 8000,
  depth: 'auto',
  effort: 'medium',
  intensityOverrides: false,
  modeDefaults: {
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
  },
  contextToggles: DEFAULT_CONTEXT_TOGGLES,
  approvalMode: 'guided',
  runBudget: DEFAULT_RUN_BUDGET,
  developerEnabled: false,
  debugLogging: false,
  modelIoLogging: false,
  features: { codeReviewButton: false },
  tokenBudget: DEFAULT_TOKEN_BUDGET,
  loopPolicy: DEFAULT_LOOP_POLICY,
  v8LoopPolicy: DEFAULT_LOOP_POLICY,
  policyLab: DEFAULT_POLICY_LAB,
};

export const DEFAULT_AUTOCOMPLETE: AutocompleteSettingsSnapshot = {
  enabled: false,
  provider: 'openai-compatible',
  baseUrl: '',
  model: '',
  endpointPath: 'completions',
  authHeader: 'authorization',
  maxTokens: 96,
  debounceMs: 250,
  timeoutMs: 4000,
  prefixChars: 6000,
  suffixChars: 2000,
  temperature: 0.2,
};

export const DEFAULT_SEARCH: SearchSettingsSnapshot = {
  searxngBaseUrl: '',
  hasApiKey: false,
};
