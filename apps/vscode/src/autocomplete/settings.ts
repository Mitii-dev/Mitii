import type * as vscode from 'vscode';

export type AutocompleteAuthHeader =
  | 'authorization'
  | 'api-key'
  | 'x-api-key';

export interface AutocompleteSettingsSnapshot {
  enabled: boolean;
  provider: 'openai-compatible';
  baseUrl: string;
  model: string;
  endpointPath: string;
  authHeader: AutocompleteAuthHeader;
  maxTokens: number;
  debounceMs: number;
  timeoutMs: number;
  prefixChars: number;
  suffixChars: number;
  temperature: number;
}

export type AutocompleteSettingsPatch = Partial<AutocompleteSettingsSnapshot>;

export const DEFAULT_AUTOCOMPLETE_SETTINGS: AutocompleteSettingsSnapshot = {
  enabled: false,
  provider: 'openai-compatible',
  baseUrl: '',
  model: '',
  endpointPath: 'completions',
  authHeader: 'authorization',
  maxTokens: 96,
  debounceMs: 250,
  timeoutMs: 4_000,
  prefixChars: 6_000,
  suffixChars: 2_000,
  temperature: 0.2,
};

const AUTOCOMPLETE_AUTH_HEADERS = new Set<AutocompleteAuthHeader>([
  'authorization',
  'api-key',
  'x-api-key',
]);

export function normalizeAutocompleteInt(
  raw: unknown,
  fallback: number,
  options: { min: number; max: number },
): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(options.min, Math.min(options.max, Math.floor(value)));
}

export function normalizeAutocompleteNumber(
  raw: unknown,
  fallback: number,
  options: { min: number; max: number },
): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(options.min, Math.min(options.max, value));
}

export function normalizeAutocompleteEndpointPath(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return DEFAULT_AUTOCOMPLETE_SETTINGS.endpointPath;
  return text.replace(/^\/+/, '');
}

export function normalizeAutocompleteAuthHeader(
  raw: unknown,
): AutocompleteAuthHeader {
  return AUTOCOMPLETE_AUTH_HEADERS.has(raw as AutocompleteAuthHeader)
    ? (raw as AutocompleteAuthHeader)
    : DEFAULT_AUTOCOMPLETE_SETTINGS.authHeader;
}

export function readAutocompleteSettings(
  cfg: vscode.WorkspaceConfiguration,
): AutocompleteSettingsSnapshot {
  return {
    enabled: cfg.get<boolean>('autocomplete.enabled') === true,
    provider: 'openai-compatible',
    baseUrl: cfg.get<string>('autocomplete.baseUrl')?.trim() ?? '',
    model: cfg.get<string>('autocomplete.model')?.trim() ?? '',
    endpointPath: normalizeAutocompleteEndpointPath(
      cfg.get<string>('autocomplete.endpointPath'),
    ),
    authHeader: normalizeAutocompleteAuthHeader(
      cfg.get<string>('autocomplete.authHeader'),
    ),
    maxTokens: normalizeAutocompleteInt(
      cfg.get<number>('autocomplete.maxTokens'),
      DEFAULT_AUTOCOMPLETE_SETTINGS.maxTokens,
      { min: 1, max: 512 },
    ),
    debounceMs: normalizeAutocompleteInt(
      cfg.get<number>('autocomplete.debounceMs'),
      DEFAULT_AUTOCOMPLETE_SETTINGS.debounceMs,
      { min: 0, max: 2_000 },
    ),
    timeoutMs: normalizeAutocompleteInt(
      cfg.get<number>('autocomplete.timeoutMs'),
      DEFAULT_AUTOCOMPLETE_SETTINGS.timeoutMs,
      { min: 250, max: 30_000 },
    ),
    prefixChars: normalizeAutocompleteInt(
      cfg.get<number>('autocomplete.prefixChars'),
      DEFAULT_AUTOCOMPLETE_SETTINGS.prefixChars,
      { min: 128, max: 60_000 },
    ),
    suffixChars: normalizeAutocompleteInt(
      cfg.get<number>('autocomplete.suffixChars'),
      DEFAULT_AUTOCOMPLETE_SETTINGS.suffixChars,
      { min: 0, max: 60_000 },
    ),
    temperature: normalizeAutocompleteNumber(
      cfg.get<number>('autocomplete.temperature'),
      DEFAULT_AUTOCOMPLETE_SETTINGS.temperature,
      { min: 0, max: 2 },
    ),
  };
}

export function resolveAutocompleteRuntimeSettings(params: {
  autocomplete: AutocompleteSettingsSnapshot;
  providerBaseUrl?: string;
  providerModel?: string;
}): AutocompleteSettingsSnapshot {
  const providerBaseUrl = params.providerBaseUrl?.trim() ?? '';
  const providerModel = params.providerModel?.trim() ?? '';
  return {
    ...params.autocomplete,
    baseUrl: params.autocomplete.baseUrl.trim() || providerBaseUrl,
    model: params.autocomplete.model.trim() || providerModel,
  };
}
