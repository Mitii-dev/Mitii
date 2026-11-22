import type * as vscode from 'vscode';

import {
  getProviderPreset,
  PROVIDER_PRESETS,
  resolveProviderApiKey,
} from '@mitii/host';
import { normalizeIntensitySettings } from '@mitii/ui-core';

import {
  readAutocompleteSettings,
} from '../autocomplete/settings.js';
import { resolveContextToggles } from '../contextToggles.js';
import { readModelIoLoggingEnabled } from '../modelIoSettings.js';
import {
  readPolicyLabSettings,
  type readShipBandTables,
} from '../policyLab.js';
import type {
  AutocompleteSettingsSnapshot,
  ProviderSettingsSnapshot,
  SearchSettingsSnapshot,
  UiSettingsSnapshot,
  WorkspaceSnapshotInfo,
} from '../protocol.js';
import {
  readStoredContextWindow,
  normalizeMaximumOutputTokens,
} from '../settingsFields.js';
import {
  readLoopPolicySettings,
} from '../loopPolicySettings.js';
import { readTokenBudgetSettings } from '../tokenBudgetSettings.js';
import { readV8LoopPolicySettings } from '../v8LoopPolicySettings.js';
import { readRunBudgetSettings, resolveContextWindow } from './configValues.js';

/** Provider connection state shown next to persisted provider settings. */
export interface ProviderReadState {
  discoveredModels: readonly string[];
  connectionOk?: boolean;
  connectionStatus?: string;
}

/** Unsaved Policy Admin edit state mirrored into the UI snapshot. */
export interface PolicyLabReadState {
  editBand: 'compact' | 'standard' | 'wide' | undefined;
  draftTables: ReturnType<typeof readShipBandTables> | undefined;
}

export function buildAvailableModels(
  discoveredModels: readonly string[],
  currentModel: string,
  type?: string,
  presetId?: string,
): string[] {
  const set = new Set<string>();
  if (currentModel.trim()) set.add(currentModel.trim());
  const providerPreset = getProviderPreset(presetId ?? type ?? '');
  for (const id of providerPreset?.models ?? []) {
    if (id.trim()) set.add(id.trim());
  }
  for (const id of discoveredModels) {
    if (id.trim()) set.add(id.trim());
  }
  return [...set];
}

export function inferProviderPreset(
  type: string,
  preset: string | undefined,
  baseUrl: string,
  model: string,
): string | undefined {
  if (preset && getProviderPreset(preset)) return preset;
  if (type === 'echo') return 'echo';
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '').toLowerCase();
  const exactBase = PROVIDER_PRESETS.find(
    (entry) =>
      entry.type === type &&
      entry.baseUrl.trim().replace(/\/+$/, '').toLowerCase() === normalizedBase,
  );
  if (exactBase) return exactBase.id;
  const exactModel = PROVIDER_PRESETS.find(
    (entry) => entry.type === type && entry.model === model,
  );
  return exactModel?.id;
}

export async function readProviderSettings(
  vs: typeof vscode,
  secrets: vscode.SecretStorage,
  state: ProviderReadState,
): Promise<ProviderSettingsSnapshot> {
  const cfg = vs.workspace.getConfiguration('mitii');
  const type = cfg.get<string>('provider.type') ?? 'echo';
  const configuredPreset = cfg.get<string>('provider.preset') ?? undefined;
  const baseUrl =
    cfg.get<string>('provider.baseUrl') ?? '';
  const model = cfg.get<string>('provider.model') ?? '';
  const preset = inferProviderPreset(
    type,
    configuredPreset,
    baseUrl,
    model,
  );
  const hasApiKey = Boolean(
    resolveProviderApiKey({
      type,
      env: process.env,
      secretKey:
        (await secrets.get('mitii.provider.apiKey')) ?? undefined,
    }),
  );
  const contextWindow = readStoredContextWindow(
    cfg.get<number>('provider.contextWindow'),
  );
  const fromMaxOut = cfg.get<number>('provider.maximumOutputTokens');
  const maximumOutputTokens = normalizeMaximumOutputTokens(fromMaxOut);
  return {
    type,
    preset,
    baseUrl,
    model,
    hasApiKey,
    availableModels: buildAvailableModels(state.discoveredModels, model, type, preset),
    contextWindow,
    effectiveContextWindow: resolveContextWindow(vs),
    maximumOutputTokens,
    connectionOk: state.connectionOk,
    connectionStatus: state.connectionStatus,
  };
}

export function readAutocomplete(
  vs: typeof vscode,
): AutocompleteSettingsSnapshot {
  return readAutocompleteSettings(vs.workspace.getConfiguration('mitii'));
}

export async function readSearchSettings(
  vs: typeof vscode,
  secrets: vscode.SecretStorage,
): Promise<SearchSettingsSnapshot> {
  const cfg = vs.workspace.getConfiguration('mitii');
  const searxngBaseUrl = cfg.get<string>('search.searxngBaseUrl')?.trim() ?? '';
  const hasApiKey = Boolean(
    (await secrets.get('mitii.search.apiKey'))?.trim() ||
      process.env.MITII_SEARCH_API_KEY?.trim() ||
      process.env.BRAVE_API_KEY?.trim(),
  );
  return { searxngBaseUrl, hasApiKey };
}

export function readUiSettings(
  vs: typeof vscode,
  policyLab: PolicyLabReadState,
): UiSettingsSnapshot {
  const cfg = vs.workspace.getConfiguration('mitii');
  const legacyDepth =
    (cfg.get<string>('ui.depth') as UiSettingsSnapshot['depth']) ?? 'auto';
  const legacyApproval = cfg.get<string>('safety.approvalMode') ?? 'guided';
  const defaultModeSettings = {
    ask: {
      thoroughness: 'medium' as const,
      depth: 'auto' as const,
      approvalMode: 'guided',
      model: '',
    },
    plan: {
      thoroughness: 'high' as const,
      depth: 'deep' as const,
      approvalMode: 'guided',
      model: '',
    },
    agent: {
      thoroughness: 'medium' as const,
      depth: 'auto' as const,
      approvalMode: 'safe',
      model: '',
    },
  };
  const readModeDepth = (
    mode: 'ask' | 'plan' | 'agent',
  ): UiSettingsSnapshot['depth'] =>
    (cfg.get<string>(
      `ui.modeDefaults.${mode}.depth`,
    ) as UiSettingsSnapshot['depth']) ??
    defaultModeSettings[mode].depth ??
    legacyDepth;
  const readModeThoroughness = (
    mode: 'ask' | 'plan' | 'agent',
  ): UiSettingsSnapshot['modeDefaults']['ask']['thoroughness'] | undefined => {
    const value = cfg.get<string>(`ui.modeDefaults.${mode}.thoroughness`);
    return value === 'low' || value === 'medium' || value === 'high'
      ? value
      : undefined;
  };
  const readModeApproval = (mode: 'ask' | 'plan' | 'agent'): string => {
    const configured = cfg.get<string>(
      `ui.modeDefaults.${mode}.approvalMode`,
    );
    if (configured === 'builder') return 'guided';
    return configured ?? defaultModeSettings[mode].approvalMode;
  };
  const readModeModel = (mode: 'ask' | 'plan' | 'agent'): string =>
    cfg.get<string>(`ui.modeDefaults.${mode}.model`)?.trim() ?? '';
  const storedEffort = cfg.get<string>('ui.effort');
  const effort: UiSettingsSnapshot['effort'] =
    storedEffort === 'low' ||
    storedEffort === 'high' ||
    storedEffort === 'medium'
      ? storedEffort
      : 'medium';
  const normalized = normalizeIntensitySettings({
    effort,
    intensityOverrides:
      cfg.get<boolean>('developer.intensityOverrides') === true,
    modeDefaults: {
      ask: {
        depth: readModeDepth('ask'),
        thoroughness: readModeThoroughness('ask'),
        approvalMode: readModeApproval('ask'),
        model: readModeModel('ask'),
      },
      plan: {
        depth: readModeDepth('plan'),
        thoroughness: readModeThoroughness('plan'),
        approvalMode: readModeApproval('plan'),
        model: readModeModel('plan'),
      },
      agent: {
        depth: readModeDepth('agent'),
        thoroughness: readModeThoroughness('agent'),
        approvalMode: readModeApproval('agent'),
        model: readModeModel('agent'),
      },
    },
  });
  return {
    showReasoning: cfg.get<boolean>('ui.showReasoning') ?? true,
    reasoningPreviewMaxChars:
      cfg.get<number>('ui.reasoningPreviewMaxChars') ?? 8000,
    depth: legacyDepth,
    effort: normalized.effort,
    intensityOverrides: normalized.intensityOverrides,
    modeDefaults: normalized.modeDefaults,
    contextToggles: resolveContextToggles(cfg),
    approvalMode: legacyApproval,
    runBudget: readRunBudgetSettings(vs),
    developerEnabled: cfg.get<boolean>('developer.enabled') ?? false,
    debugLogging: cfg.get<boolean>('debug') ?? false,
    modelIoLogging: readModelIoLoggingEnabled(cfg),
    features: {
      codeReviewButton:
        cfg.get<boolean>('ui.features.codeReviewButton') === true,
    },
    tokenBudget: readTokenBudgetSettings(
      cfg,
      resolveContextWindow(vs),
      cfg.get<number>('provider.maximumOutputTokens'),
    ),
    loopPolicy: readLoopPolicySettings(cfg, resolveContextWindow(vs)),
    v8LoopPolicy: readV8LoopPolicySettings(
      cfg,
      resolveContextWindow(vs),
    ),
    policyLab: readPolicyLabSettings(
      resolveContextWindow(vs),
      policyLab.editBand,
      policyLab.draftTables,
    ),
  };
}

export function readWorkspaceInfo(
  vs: typeof vscode,
  getWorkspaceRoot: () => string | undefined,
): WorkspaceSnapshotInfo {
  const root = getWorkspaceRoot();
  const rootOverride = vs.workspace
    .getConfiguration('mitii')
    .get<string>('workspace.rootPathOverride')
    ?.trim();
  return {
    root,
    rootOverride: rootOverride || undefined,
    displayRoot: rootOverride || root,
  };
}
