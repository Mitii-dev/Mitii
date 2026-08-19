import { describe, expect, it } from 'vitest';

import { findLocalModelPreset } from '../../../apps/vscode/src/modelPresets';
import {
  applyProviderPatch,
  applyProviderTokenLimits,
  applyTokenBudgetPolicyField,
  applyUiPatch,
  DEFAULT_CONTEXT_TOGGLES,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODE_DEFAULTS,
  DEFAULT_RUN_BUDGET,
  isSettingsNavCompact,
  normalizeTokenLimit,
  parseNumberFieldDraft,
  readStoredContextWindow,
  reflectProviderTokenLimits,
  reflectUiAfterSave,
  resolveEffectiveContextWindow,
  SETTINGS_FIELDS,
  SETTINGS_NAV_COMPACT_MAX_WIDTH,
  SETTINGS_NAV_ITEMS,
  settingsIconTooltip,
  shouldPostWebviewReady,
  tokenLimitDraftAfterHostEcho,
} from '../../../apps/vscode/src/settingsFields';
import {
  defaultTokenBudgetSettings,
  TOKEN_BUDGET_FIELDS,
  tokenBudgetResetKeys,
} from '../../../apps/vscode/src/tokenBudgetSettings';
import type {
  ProviderSettingsSnapshot,
  UiSettingsSnapshot,
} from '../../../apps/vscode/src/protocol';

const BASE_PROVIDER: ProviderSettingsSnapshot = {
  type: 'openai-compatible',
  preset: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen3-coder:30b',
  hasApiKey: false,
  availableModels: ['qwen3-coder:30b'],
  contextWindow: 0,
  maximumOutputTokens: 0,
};

const BASE_UI: UiSettingsSnapshot = {
  showReasoning: true,
  reasoningPreviewMaxChars: 8000,
  depth: 'auto',
  effort: 'medium',
  modeDefaults: DEFAULT_MODE_DEFAULTS,
  contextToggles: DEFAULT_CONTEXT_TOGGLES,
  approvalMode: 'guided',
  runBudget: DEFAULT_RUN_BUDGET,
  developerEnabled: false,
  debugLogging: false,
  tokenBudget: {
    enabled: false,
    policy: {},
    fields: [...TOKEN_BUDGET_FIELDS],
    preview: {
      contextWindowTokens: DEFAULT_CONTEXT_WINDOW,
      maximumOutputTokens: 3277,
      toolSchemaTokens: 6554,
      usableInputTokens: 22937,
      loopInputBudgetTokens: 21560,
      repositoryTokens: 6422,
      conversationTokens: 9174,
      planTokens: 1376,
      skillsTokens: 917,
      systemTokens: 5048,
      compactionWarnTokens: 15092,
      compactionAutoTokens: 17248,
      compactionHardTokens: 19835,
      keepRecentToolResults: 3,
      compactedToolResultChars: 400,
      compactedToolArgumentChars: 256,
      toolResultContentChars: 2000,
      droppedTurnSummaryChars: 1200,
      establishedFactChars: 220,
      maxEstablishedFacts: 12,
      establishedFactReinjectChars: 1600,
      memoryReinjectChars: 800,
      maxPatchesPerCall: 8,
      maxModelCalls: 64,
      maxToolCalls: 128,
      maxUniqueFilesPerCall: 4,
      maxPatchPayloadCharacters: 5898,
      requireBatchedExecution: true,
      maxDiagnosticSteps: 3,
      maxSkills: 3,
      maxVerificationChecks: 2,
      visiblePlanAffordable: false,
      changeImpactAffordable: false,
      runBudgetUnlimited: false,
      runBudgetMaxModelCalls: 64,
      runBudgetMaxToolCalls: 128,
    },
  },
};

function emptyStore(): Record<string, unknown> {
  return {};
}

function writeField(
  store: Record<string, unknown>,
  setting: string,
  value: unknown,
): void {
  store[setting] = value;
}

function readField(store: Record<string, unknown>, setting: string): unknown {
  return store[setting];
}

function editSaveReflect(fieldId: string, edited: unknown): unknown {
  const field = SETTINGS_FIELDS.find((entry) => entry.id === fieldId);
  if (!field) throw new Error(`Unknown field ${fieldId}`);
  const store = emptyStore();
  let persisted: unknown = edited;
  if (field.kind === 'int') {
    persisted = normalizeTokenLimit(edited);
    if (field.min !== undefined && field.min > 0) {
      persisted = Math.max(field.min, Number(persisted) || field.min);
    }
  } else if (field.kind === 'number') {
    const parsed = Number(edited);
    persisted = Number.isFinite(parsed) ? parsed : field.sample;
    if (field.min !== undefined) {
      persisted = Math.max(field.min, Number(persisted));
    }
    if (field.max !== undefined) {
      persisted = Math.min(field.max, Number(persisted));
    }
  }
  writeField(store, field.setting, persisted);
  return readField(store, field.setting);
}

describe('settings field catalog', () => {
  it('covers every settings page', () => {
    const pages = new Set(SETTINGS_FIELDS.map((field) => field.page));
    expect([...pages].sort()).toEqual([
      'context',
      'developer',
      'mcp',
      'modes',
      'provider',
      'workspace',
    ]);
  });

  it('lists every visible token-budget field', () => {
    const budgetIds = SETTINGS_FIELDS.filter(
      (field) =>
        field.id.startsWith('tokenBudget.') && field.id !== 'tokenBudget.enabled',
    ).map((field) => field.id.replace('tokenBudget.', ''));
    const visible = TOKEN_BUDGET_FIELDS.filter(
      (field) => !field.hiddenFromDebug,
    ).map((field) => field.key);
    expect(budgetIds).toEqual(visible);
  });

  it.each(SETTINGS_FIELDS.map((field) => [field.id, field] as const))(
    'edits, saves, and reflects %s',
    (_id, field) => {
      const reflected = editSaveReflect(field.id, field.sample);
      if (field.kind === 'int') {
        const expected = Math.max(field.min ?? 0, Math.floor(Number(field.sample)));
        expect(reflected).toBe(expected);
      } else {
        expect(reflected).toEqual(field.sample);
      }
      expect(field.reflect).toBe('raw');
    },
  );
});

describe('context window edit / save / reflect', () => {
  it('keeps a typed draft until commit so a host bootstrap cannot clobber mid-edit', () => {
    const displayed = 30_000;
    const draft = parseNumberFieldDraft('16000', { min: 0, integer: true });
    expect(draft).toBe(16_000);
    expect(draft).not.toBe(displayed);
    const stored = applyProviderTokenLimits(
      { contextWindow: displayed, maximumOutputTokens: 5_000 },
      { contextWindow: draft, maximumOutputTokens: 2_048 },
    );
    const reflected = reflectProviderTokenLimits({
      ...stored,
      model: 'qwen3-coder:30b',
    });
    expect(reflected.contextWindow).toBe(16_000);
    expect(reflected.maximumOutputTokens).toBe(2_048);
  });

  it('lets the user type a custom window and keeps that raw value after save', () => {
    const typed = parseNumberFieldDraft('8192', { min: 0, integer: true });
    expect(typed).toBe(8192);

    const stored = applyProviderTokenLimits(BASE_PROVIDER, {
      contextWindow: typed,
    });
    expect(stored.contextWindow).toBe(8192);

    const reflected = reflectProviderTokenLimits({
      ...stored,
      model: BASE_PROVIDER.model,
    });
    expect(reflected.contextWindow).toBe(8192);
    expect(reflected.effectiveContextWindow).toBe(8192);
  });

  it('accepts intermediate typed digits that are not multiples of 1024', () => {
    expect(parseNumberFieldDraft('8', { min: 0, integer: true })).toBe(8);
    expect(parseNumberFieldDraft('81', { min: 0, integer: true })).toBe(81);
    expect(parseNumberFieldDraft('819', { min: 0, integer: true })).toBe(819);
    expect(parseNumberFieldDraft('100000', { min: 0, integer: true })).toBe(
      100000,
    );
  });

  it('stores 0 and reflects 0 in the settings field', () => {
    const stored = applyProviderTokenLimits(
      { ...BASE_PROVIDER, contextWindow: 8192 },
      { contextWindow: 0 },
    );
    expect(stored.contextWindow).toBe(0);

    const reflected = reflectProviderTokenLimits({
      contextWindow: readStoredContextWindow(stored.contextWindow),
      maximumOutputTokens: stored.maximumOutputTokens,
      model: 'qwen3-coder:30b',
    });
    expect(reflected.contextWindow).toBe(0);
    expect(reflected.effectiveContextWindow).toBe(
      findLocalModelPreset('qwen3-coder:30b')?.contextWindow,
    );
  });

  it('does not replace a saved 0 with the resolved preset in the UI snapshot', () => {
    const afterSave = applyProviderPatch(BASE_PROVIDER, { contextWindow: 0 });
    expect(afterSave.contextWindow).toBe(0);
    expect(afterSave.effectiveContextWindow).toBeGreaterThan(0);
    expect(afterSave.contextWindow).not.toBe(afterSave.effectiveContextWindow);
  });

  it('resolves an unknown model to the default window when stored is 0', () => {
    expect(resolveEffectiveContextWindow(0, 'not-a-preset')).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
  });

  it('rejects blank and non-numeric drafts without committing', () => {
    expect(parseNumberFieldDraft('', { min: 0, integer: true })).toBeUndefined();
    expect(parseNumberFieldDraft('abc', { min: 0, integer: true })).toBeUndefined();
  });

  it('clamps negative token limits to 0 on save', () => {
    expect(normalizeTokenLimit(-12)).toBe(0);
    expect(normalizeTokenLimit(Number.NaN)).toBe(0);
    expect(normalizeTokenLimit(4096.9)).toBe(4096);
  });
});

describe('max output edit / save / reflect', () => {
  it('saves a custom max output and reflects the same raw value', () => {
    const typed = parseNumberFieldDraft('2048', { min: 0, integer: true });
    const stored = applyProviderTokenLimits(BASE_PROVIDER, {
      maximumOutputTokens: typed,
    });
    const reflected = reflectProviderTokenLimits({
      ...stored,
      model: BASE_PROVIDER.model,
    });
    expect(reflected.maximumOutputTokens).toBe(2048);
  });

  it('keeps 0 after save so the host can derive the reserve', () => {
    const stored = applyProviderTokenLimits(
      { ...BASE_PROVIDER, maximumOutputTokens: 2048 },
      { maximumOutputTokens: 0 },
    );
    expect(stored.maximumOutputTokens).toBe(0);
    expect(
      reflectProviderTokenLimits({
        ...stored,
        model: BASE_PROVIDER.model,
      }).maximumOutputTokens,
    ).toBe(0);
  });
});

describe('provider connection fields', () => {
  it('saves provider, base URL, and model and reflects them', () => {
    const next = applyProviderPatch(BASE_PROVIDER, {
      type: 'anthropic',
      preset: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
    });
    expect(next.type).toBe('anthropic');
    expect(next.preset).toBe('anthropic');
    expect(next.baseUrl).toBe('https://api.anthropic.com');
    expect(next.model).toBe('claude-sonnet-4-5');
  });
});

describe('modes fields', () => {
  it('saves per-mode depth, approval, and model and reflects them', () => {
    const next = applyUiPatch(BASE_UI, {
      modeDefaults: {
        ask: { depth: 'quick', approvalMode: 'safe', model: 'qwen3.5:9b' },
        plan: { depth: 'deep', approvalMode: 'guided', model: 'qwen3-coder:30b' },
        agent: { depth: 'auto', approvalMode: 'pilot', model: 'qwen3.5:latest' },
      },
    });
    const reflected = reflectUiAfterSave(next);
    expect(reflected.modeDefaults.ask).toEqual({
      depth: 'quick',
      approvalMode: 'safe',
      model: 'qwen3.5:9b',
    });
    expect(reflected.modeDefaults.plan.model).toBe('qwen3-coder:30b');
    expect(reflected.modeDefaults.agent.approvalMode).toBe('pilot');
  });

  it('saves reasoning toggles and preview length', () => {
    const next = applyUiPatch(BASE_UI, {
      showReasoning: false,
      reasoningPreviewMaxChars: 4000,
    });
    const reflected = reflectUiAfterSave(next);
    expect(reflected.showReasoning).toBe(false);
    expect(reflected.reasoningPreviewMaxChars).toBe(4000);
  });

  it('saves run budget caps and reflects them', () => {
    const next = applyUiPatch(BASE_UI, {
      runBudget: {
        unlimited: false,
        maxModelCalls: 12,
        maxToolCalls: 24,
        maxLoopIterations: 40,
        maxWallTimeMinutes: 15,
      },
    });
    const reflected = reflectUiAfterSave(next);
    expect(reflected.runBudget).toEqual({
      unlimited: false,
      maxModelCalls: 12,
      maxToolCalls: 24,
      maxLoopIterations: 40,
      maxWallTimeMinutes: 15,
    });
  });

  it('clamps invalid run-budget numbers on reflect', () => {
    const next = applyUiPatch(BASE_UI, {
      runBudget: {
        unlimited: true,
        maxModelCalls: 0,
        maxToolCalls: -3,
        maxLoopIterations: Number.NaN,
        maxWallTimeMinutes: 0,
      },
    });
    const reflected = reflectUiAfterSave(next);
    expect(reflected.runBudget.unlimited).toBe(true);
    expect(reflected.runBudget.maxModelCalls).toBeGreaterThanOrEqual(1);
    expect(reflected.runBudget.maxToolCalls).toBeGreaterThanOrEqual(1);
    expect(reflected.runBudget.maxLoopIterations).toBeGreaterThanOrEqual(1);
    expect(reflected.runBudget.maxWallTimeMinutes).toBeGreaterThanOrEqual(1);
  });
});

describe('context fields', () => {
  it('saves each context toggle independently and reflects the merge', () => {
    const next = applyUiPatch(BASE_UI, {
      contextToggles: { openTabs: true, memory: false },
    });
    expect(next.contextToggles).toEqual({
      ...DEFAULT_CONTEXT_TOGGLES,
      openTabs: true,
      memory: false,
    });
  });
});

describe('developer fields', () => {
  it('saves access, logging, and custom token-budget gate', () => {
    const next = applyUiPatch(BASE_UI, {
      developerEnabled: true,
      debugLogging: true,
      tokenBudget: { enabled: true },
    });
    expect(next.developerEnabled).toBe(true);
    expect(next.debugLogging).toBe(true);
    expect(next.tokenBudget.enabled).toBe(true);
    expect(next.tokenBudget.fields).toBe(BASE_UI.tokenBudget.fields);
  });

  it.each(
    TOKEN_BUDGET_FIELDS.filter((field) => !field.hiddenFromDebug).map(
      (field) => [field.key, field] as const,
    ),
  )('edits, saves, and reflects token budget %s', (key, field) => {
    const edited =
      field.kind === 'ratio'
        ? Math.min(field.max ?? 1, Math.max(field.min, 0.33))
        : Math.max(field.min, (field.step || 1) * 2);
    const policy = applyTokenBudgetPolicyField({}, key, edited);
    expect(policy[key]).toBeDefined();
    expect(Number.isFinite(policy[key])).toBe(true);
    expect(policy[key]).toBeGreaterThanOrEqual(field.min);
    if (field.max !== undefined) {
      expect(policy[key]).toBeLessThanOrEqual(field.max);
    }
    if (field.kind === 'int') {
      expect(Number.isInteger(policy[key])).toBe(true);
    }
  });

  it('ignores unknown token-budget keys', () => {
    expect(applyTokenBudgetPolicyField({ outputRatio: 0.1 }, 'notAKey', 9)).toEqual(
      { outputRatio: 0.1 },
    );
  });
});

describe('workspace override', () => {
  it('saves a trimmed override and can clear it', () => {
    const store = emptyStore();
    writeField(store, 'workspace.rootPathOverride', '/tmp/mitii-workspace');
    expect(readField(store, 'workspace.rootPathOverride')).toBe(
      '/tmp/mitii-workspace',
    );
    writeField(store, 'workspace.rootPathOverride', null);
    expect(readField(store, 'workspace.rootPathOverride')).toBeNull();
  });
});

describe('compact settings nav tooltips', () => {
  it('collapses the left bar at the compact breakpoint', () => {
    expect(isSettingsNavCompact(300)).toBe(true);
    expect(isSettingsNavCompact(SETTINGS_NAV_COMPACT_MAX_WIDTH)).toBe(true);
    expect(isSettingsNavCompact(SETTINGS_NAV_COMPACT_MAX_WIDTH + 1)).toBe(false);
    expect(isSettingsNavCompact(Number.NaN)).toBe(false);
  });

  it('shows a tooltip label for every icon when the bar is compact', () => {
    for (const item of SETTINGS_NAV_ITEMS) {
      expect(settingsIconTooltip(item.label, true)).toBe(item.label);
    }
  });

  it('hides icon tooltips when the bar is expanded', () => {
    for (const item of SETTINGS_NAV_ITEMS) {
      expect(settingsIconTooltip(item.label, false)).toBeUndefined();
    }
  });

  it('covers the current settings pages in the icon rail', () => {
    expect(SETTINGS_NAV_ITEMS.map((item) => item.id)).toEqual([
      'model',
      'workspace',
      'modes',
      'context',
      'integrations',
      'debug',
    ]);
  });
});

describe('token limits must not snap back to 30000 while editing', () => {
  it('does not post webview ready again after the first bootstrap', () => {
    expect(shouldPostWebviewReady(false)).toBe(true);
    expect(shouldPostWebviewReady(true)).toBe(false);
  });

  it('keeps a 16000 / 2048 draft when the host echoes the old 30000 / 5000', () => {
    const next = tokenLimitDraftAfterHostEcho({
      focused: true,
      draftContextWindow: 16_000,
      draftMaxOutput: 2_048,
      storedContextWindow: 30_000,
      storedMaxOutput: 5_000,
    });
    expect(next).toEqual({
      contextWindow: 16_000,
      maximumOutputTokens: 2_048,
    });
  });

  it('reflects the saved 30000 only after the field is no longer focused', () => {
    const next = tokenLimitDraftAfterHostEcho({
      focused: false,
      draftContextWindow: 16_000,
      draftMaxOutput: 2_048,
      storedContextWindow: 30_000,
      storedMaxOutput: 5_000,
    });
    expect(next).toEqual({
      contextWindow: 30_000,
      maximumOutputTokens: 5_000,
    });
  });

  it('saves a change away from 30000 / 5000 and reflects the new raw values', () => {
    const typedWindow = parseNumberFieldDraft('16000', {
      min: 0,
      integer: true,
    });
    const typedOutput = parseNumberFieldDraft('2048', {
      min: 0,
      integer: true,
    });
    const stored = applyProviderTokenLimits(
      { contextWindow: 30_000, maximumOutputTokens: 5_000 },
      { contextWindow: typedWindow, maximumOutputTokens: typedOutput },
    );
    const reflected = reflectProviderTokenLimits({
      ...stored,
      model: 'qwen3-coder:30b',
    });
    expect(reflected.contextWindow).toBe(16_000);
    expect(reflected.maximumOutputTokens).toBe(2_048);
    expect(reflected.contextWindow).not.toBe(30_000);
  });
});

describe('window-scaled token budget defaults', () => {
  it('lists every custom token-budget key so Reset can clear them', () => {
    const keys = tokenBudgetResetKeys();
    expect(keys).toContain('tokenBudget.enabled');
    for (const field of TOKEN_BUDGET_FIELDS) {
      expect(keys).toContain(`tokenBudget.${field.key}`);
    }
    expect(keys).toHaveLength(TOKEN_BUDGET_FIELDS.length + 1);
  });

  it('marks high-level budget fields as simple and the rest as advanced', () => {
    const simple = TOKEN_BUDGET_FIELDS.filter((field) => field.tier === 'simple').map(
      (field) => field.key,
    );
    expect(simple).toEqual([
      'outputRatio',
      'repositoryShare',
      'conversationShare',
      'planShare',
      'skillsShare',
    ]);
    expect(
      TOKEN_BUDGET_FIELDS.every((field) => typeof field.defaultValue === 'number'),
    ).toBe(true);
    expect(
      TOKEN_BUDGET_FIELDS.filter((field) => field.tier !== 'simple').every(
        (field) => field.tier === 'advanced',
      ),
    ).toBe(true);
  });

  it('scales derived budgets from the context window without custom overrides', () => {
    const at30k = defaultTokenBudgetSettings(30_000);
    const at60k = defaultTokenBudgetSettings(60_000);
    expect(at30k.enabled).toBe(false);
    expect(at60k.enabled).toBe(false);
    expect(at60k.preview.contextWindowTokens).toBe(60_000);
    expect(at60k.preview.usableInputTokens).toBeGreaterThan(
      at30k.preview.usableInputTokens,
    );
    expect(at60k.preview.maximumOutputTokens).toBeGreaterThan(
      at30k.preview.maximumOutputTokens,
    );
    expect(at60k.preview.maxUniqueFilesPerCall).toBeGreaterThanOrEqual(
      at30k.preview.maxUniqueFilesPerCall,
    );
    expect(at60k.preview.maxVerificationChecks).toBeGreaterThanOrEqual(
      at30k.preview.maxVerificationChecks,
    );
  });
});
