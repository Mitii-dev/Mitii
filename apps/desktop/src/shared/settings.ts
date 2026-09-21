/**
 * Desktop settings — full parity with VS Code `mitii.*` configuration.
 * Defaults come from apps/vscode package.json (generated).
 * Secrets never live in these JSON files.
 */

import type { DesktopAgentMode } from './protocol.js';
import {
  DEFAULT_DESKTOP_SETTINGS,
  SETTINGS_CATALOG,
  type DesktopSettings,
} from './vscode-settings-defaults.js';

export {
  DEFAULT_DESKTOP_SETTINGS,
  SETTINGS_CATALOG,
  type DesktopSettings,
};

export type DesktopProviderType =
  | 'echo'
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini';

export type DesktopProviderPreset =
  | 'echo'
  | 'ollama'
  | 'ollama-cloud'
  | 'lm-studio'
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'azure-openai'
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini';

export type { DesktopAgentMode };

export const PROVIDER_PRESET_OPTIONS: Array<{
  id: DesktopProviderPreset;
  label: string;
  type: DesktopProviderType;
}> = [
  { id: 'echo', label: 'Echo (local stub)', type: 'echo' },
  { id: 'ollama', label: 'Ollama', type: 'openai-compatible' },
  { id: 'ollama-cloud', label: 'Ollama Cloud', type: 'openai-compatible' },
  { id: 'lm-studio', label: 'LM Studio', type: 'openai-compatible' },
  { id: 'openai', label: 'OpenAI', type: 'openai-compatible' },
  { id: 'openrouter', label: 'OpenRouter', type: 'openai-compatible' },
  { id: 'deepseek', label: 'DeepSeek', type: 'openai-compatible' },
  { id: 'azure-openai', label: 'Azure OpenAI', type: 'openai-compatible' },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (/v1)',
    type: 'openai-compatible',
  },
  { id: 'anthropic', label: 'Anthropic (Claude)', type: 'anthropic' },
  { id: 'gemini', label: 'Gemini', type: 'gemini' },
];

export type SettingsTabId =
  | 'model'
  | 'autocomplete'
  | 'workspace'
  | 'modes'
  | 'context'
  | 'features'
  | 'integrations'
  | 'debug';

export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'model', label: 'Provider' },
  { id: 'autocomplete', label: 'Autocomplete' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'modes', label: 'Modes' },
  { id: 'context', label: 'Context' },
  { id: 'features', label: 'Features' },
  { id: 'integrations', label: 'MCP' },
  { id: 'debug', label: 'Developer' },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Deep-merge settings; arrays replace, objects merge. */
export function mergeDesktopSettings(
  partial: unknown,
  base: DesktopSettings = structuredClone(
    DEFAULT_DESKTOP_SETTINGS as unknown as DesktopSettings,
  ),
): DesktopSettings {
  if (!isPlainObject(partial)) {
    return structuredClone(base);
  }
  return deepMerge(base as Record<string, unknown>, partial) as DesktopSettings;
}

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Map to `.mitii/config.json` (CLI/ACP compatible subset, no secrets). */
export function settingsToMitiiConfigFile(
  settings: DesktopSettings,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    provider: settings.provider.type,
    providerPreset: settings.provider.preset,
    defaultMode: 'ask',
  };
  if (settings.provider.model.trim()) payload.model = settings.provider.model.trim();
  if (settings.provider.baseUrl.trim()) {
    payload.baseUrl = settings.provider.baseUrl.trim();
  }
  if (settings.search.searxngBaseUrl.trim()) {
    payload.searxngBaseUrl = settings.search.searxngBaseUrl.trim();
  }
  payload.embeddingSource = settings.semanticIndex.source;
  if (settings.semanticIndex.model.trim()) {
    payload.embeddingModel = settings.semanticIndex.model.trim();
  }
  if (settings.semanticIndex.dimensions > 0) {
    payload.embeddingDimensions = settings.semanticIndex.dimensions;
  }
  if (settings.loopPolicy.enabled) {
    const { enabled, ...thresholds } = settings.loopPolicy;
    payload.loopPolicy = { enabled, thresholds };
  }
  return payload;
}

export function mitiiConfigFileToSettings(
  raw: Record<string, unknown>,
  base?: DesktopSettings,
): DesktopSettings {
  const next = mergeDesktopSettings(base);
  if (typeof raw.provider === 'string') {
    next.provider.type = raw.provider as DesktopSettings['provider']['type'];
  }
  if (typeof raw.providerPreset === 'string') {
    next.provider.preset =
      raw.providerPreset as DesktopSettings['provider']['preset'];
  }
  if (typeof raw.model === 'string') next.provider.model = raw.model;
  if (typeof raw.baseUrl === 'string') next.provider.baseUrl = raw.baseUrl;
  if (typeof raw.searxngBaseUrl === 'string') {
    next.search.searxngBaseUrl = raw.searxngBaseUrl;
  }
  if (
    raw.embeddingSource === 'bundled' ||
    raw.embeddingSource === 'ollama' ||
    raw.embeddingSource === 'openai-compatible' ||
    raw.embeddingSource === 'disabled'
  ) {
    next.semanticIndex.source = raw.embeddingSource;
  }
  if (typeof raw.embeddingModel === 'string') {
    next.semanticIndex.model = raw.embeddingModel;
  }
  if (typeof raw.embeddingDimensions === 'number' && raw.embeddingDimensions > 0) {
    next.semanticIndex.dimensions = Math.floor(raw.embeddingDimensions);
  }
  if (raw.loopPolicy && typeof raw.loopPolicy === 'object') {
    const lp = raw.loopPolicy as Record<string, unknown>;
    if (lp.enabled === true && lp.thresholds && typeof lp.thresholds === 'object') {
      next.loopPolicy = {
        ...next.loopPolicy,
        enabled: true,
        ...(lp.thresholds as Record<string, number>),
      } as DesktopSettings['loopPolicy'];
    }
  }
  return next;
}

/** Env injected into the engine from settings + optional API keys. */
export function settingsToEngineEnv(
  settings: DesktopSettings,
  options: { apiKey?: string; searchApiKey?: string } = {},
): Record<string, string> {
  const env: Record<string, string> = {
    MITII_PROVIDER: String(settings.provider.type),
    MITII_PROVIDER_PRESET: String(settings.provider.preset),
  };
  if (settings.provider.model.trim()) {
    env.MITII_MODEL = settings.provider.model.trim();
  }
  if (settings.provider.baseUrl.trim()) {
    env.MITII_BASE_URL = settings.provider.baseUrl.trim();
  }
  if (settings.search.searxngBaseUrl.trim()) {
    env.MITII_SEARXNG_URL = settings.search.searxngBaseUrl.trim();
  }
  if (settings.provider.type === 'echo') {
    env.MITII_FORCE_ECHO = '1';
  } else {
    env.MITII_FORCE_ECHO = '0';
  }
  if (!settings.skills.workspace.enabled) {
    env.MITII_DISABLE_WORKSPACE_SKILLS = '1';
  }
  if (!settings.agent.taskListAutoAdvance) {
    env.MITII_TASK_LIST_AUTO_ADVANCE = '0';
  }
  if (settings.tools.applyPatch.fuzzyMatch) {
    env.MITII_APPLY_PATCH_FUZZY = '1';
  }

  const sandboxExplicit = settings.safety.sandbox.enabled;
  const sandboxOn =
    sandboxExplicit === true ||
    (sandboxExplicit === null &&
      (settings.safety.approvalMode === 'safe' ||
        settings.safety.approvalMode === 'guided'));
  if (sandboxOn) {
    env.MITII_SANDBOX = '1';
    env.MITII_SANDBOX_NETWORK = String(
      settings.safety.sandbox.network ??
        (settings.safety.approvalMode === 'pilot' ? 'allow' : 'deny'),
    );
    env.MITII_SANDBOX_BACKEND = String(settings.safety.sandbox.backend);
  } else {
    env.MITII_SANDBOX = '0';
  }

  if (options.apiKey?.trim()) {
    const key = options.apiKey.trim();
    env.MITII_API_KEY = key;
    if (settings.provider.type === 'anthropic') {
      env.MITII_ANTHROPIC_API_KEY = key;
    }
    if (settings.provider.type === 'gemini') {
      env.MITII_GEMINI_API_KEY = key;
    }
  }
  if (options.searchApiKey?.trim()) {
    env.BRAVE_API_KEY = options.searchApiKey.trim();
    env.MITII_SEARCH_API_KEY = options.searchApiKey.trim();
  }

  // Pass serialized desktop settings for hosts that read MITII_DESKTOP_SETTINGS_JSON
  env.MITII_DESKTOP_SETTINGS_JSON = JSON.stringify(settings);
  return env;
}

export function catalogEntriesForPrefix(prefix: string): Array<{
  key: string;
  shortKey: string;
  entry: (typeof SETTINGS_CATALOG)[string];
}> {
  const full = prefix.startsWith('mitii.') ? prefix : `mitii.${prefix}`;
  return Object.entries(SETTINGS_CATALOG)
    .filter(([key]) => key === full || key.startsWith(`${full}.`))
    .map(([key, entry]) => ({
      key,
      shortKey: key.slice(full.length + 1) || key.slice(6),
      entry,
    }));
}

export function getSettingAtPath(
  settings: DesktopSettings,
  dotted: string,
): unknown {
  const parts = dotted.replace(/^mitii\./, '').split('.');
  let cur: unknown = settings;
  for (const part of parts) {
    if (!isPlainObject(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setSettingAtPath(
  settings: DesktopSettings,
  dotted: string,
  value: unknown,
): DesktopSettings {
  const parts = dotted.replace(/^mitii\./, '').split('.');
  const clone = structuredClone(settings) as Record<string, unknown>;
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = cur[part];
    if (!isPlainObject(next)) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
  return clone as DesktopSettings;
}
