import type * as vscode from 'vscode';

import {
  DEFAULT_AUTOCOMPLETE_SETTINGS,
  normalizeAutocompleteAuthHeader,
  normalizeAutocompleteEndpointPath,
  normalizeAutocompleteInt,
  normalizeAutocompleteNumber,
} from '../autocomplete/settings.js';
import type {
  AutocompleteSettingsSnapshot,
  SearchSettingsSnapshot,
  WebviewToHostMessage,
} from '../protocol.js';
import {
  normalizeMaximumOutputTokens,
  normalizeTokenLimit,
} from '../settingsFields.js';
import { configValuesEqual } from './configValues.js';

export type SettingsSetMessage = Extract<
  WebviewToHostMessage,
  { type: 'settings.set' }
>;

/** Writes `mitii.*` configuration values to the right target, skipping no-ops. */
export class ConfigWriter {
  constructor(readonly vs: typeof vscode) {}

  target(): vscode.ConfigurationTarget {
    return this.vs.workspace.workspaceFolders?.length
      ? this.vs.ConfigurationTarget.Workspace
      : this.vs.ConfigurationTarget.Global;
  }

  async write(key: string, value: unknown): Promise<void> {
    const cfg = this.vs.workspace.getConfiguration('mitii');
    if (configValuesEqual(cfg.get(key), value)) return;
    await cfg.update(key, value, this.target());
  }

  /** Clear overrides so each key falls back to its package default. */
  async reset(keys: readonly string[]): Promise<void> {
    const cfg = this.vs.workspace.getConfiguration('mitii');
    const target = this.target();
    for (const key of keys) {
      await cfg.update(key, undefined, target);
    }
  }
}

export async function writeProviderValues(
  writer: ConfigWriter,
  provider: NonNullable<SettingsSetMessage['provider']>,
): Promise<void> {
  const type = provider.type ?? writer.vs.workspace.getConfiguration('mitii').get<string>('provider.type');
  if (type !== 'echo' && provider.model !== undefined && !provider.model.trim()) {
    throw new Error('Choose a model before saving provider settings. Test connection to discover available models.');
  }
  if (provider.type !== undefined) {
    await writer.write('provider.type', provider.type);
  }
  if (provider.preset !== undefined) {
    await writer.write('provider.preset', provider.preset);
  }
  if (provider.baseUrl !== undefined) {
    await writer.write('provider.baseUrl', provider.baseUrl);
  }
  if (provider.model !== undefined) {
    await writer.write('provider.model', provider.model);
  }
  if (provider.contextWindow !== undefined) {
    await writer.write(
      'provider.contextWindow',
      normalizeTokenLimit(provider.contextWindow),
    );
  }
  if (provider.maximumOutputTokens !== undefined) {
    await writer.write(
      'provider.maximumOutputTokens',
      normalizeMaximumOutputTokens(provider.maximumOutputTokens),
    );
  }
}

export async function writeAutocompleteValues(
  writer: ConfigWriter,
  autocomplete: Partial<AutocompleteSettingsSnapshot>,
): Promise<void> {
  if (autocomplete.enabled !== undefined) {
    await writer.write('autocomplete.enabled', autocomplete.enabled);
  }
  if (autocomplete.provider !== undefined) {
    await writer.write('autocomplete.provider', 'openai-compatible');
  }
  if (autocomplete.baseUrl !== undefined) {
    await writer.write(
      'autocomplete.baseUrl',
      autocomplete.baseUrl.trim(),
    );
  }
  if (autocomplete.model !== undefined) {
    await writer.write(
      'autocomplete.model',
      autocomplete.model.trim(),
    );
  }
  if (autocomplete.endpointPath !== undefined) {
    await writer.write(
      'autocomplete.endpointPath',
      normalizeAutocompleteEndpointPath(autocomplete.endpointPath),
    );
  }
  if (autocomplete.authHeader !== undefined) {
    await writer.write(
      'autocomplete.authHeader',
      normalizeAutocompleteAuthHeader(autocomplete.authHeader),
    );
  }
  if (autocomplete.maxTokens !== undefined) {
    await writer.write(
      'autocomplete.maxTokens',
      normalizeAutocompleteInt(
        autocomplete.maxTokens,
        DEFAULT_AUTOCOMPLETE_SETTINGS.maxTokens,
        {
          min: 1,
          max: 512,
        },
      ),
    );
  }
  if (autocomplete.debounceMs !== undefined) {
    await writer.write(
      'autocomplete.debounceMs',
      normalizeAutocompleteInt(
        autocomplete.debounceMs,
        DEFAULT_AUTOCOMPLETE_SETTINGS.debounceMs,
        {
          min: 0,
          max: 2_000,
        },
      ),
    );
  }
  if (autocomplete.timeoutMs !== undefined) {
    await writer.write(
      'autocomplete.timeoutMs',
      normalizeAutocompleteInt(
        autocomplete.timeoutMs,
        DEFAULT_AUTOCOMPLETE_SETTINGS.timeoutMs,
        {
          min: 250,
          max: 30_000,
        },
      ),
    );
  }
  if (autocomplete.prefixChars !== undefined) {
    await writer.write(
      'autocomplete.prefixChars',
      normalizeAutocompleteInt(
        autocomplete.prefixChars,
        DEFAULT_AUTOCOMPLETE_SETTINGS.prefixChars,
        {
          min: 128,
          max: 60_000,
        },
      ),
    );
  }
  if (autocomplete.suffixChars !== undefined) {
    await writer.write(
      'autocomplete.suffixChars',
      normalizeAutocompleteInt(
        autocomplete.suffixChars,
        DEFAULT_AUTOCOMPLETE_SETTINGS.suffixChars,
        {
          min: 0,
          max: 60_000,
        },
      ),
    );
  }
  if (autocomplete.temperature !== undefined) {
    await writer.write(
      'autocomplete.temperature',
      normalizeAutocompleteNumber(
        autocomplete.temperature,
        DEFAULT_AUTOCOMPLETE_SETTINGS.temperature,
        {
          min: 0,
          max: 2,
        },
      ),
    );
  }
}

export async function writeSearchValues(
  writer: ConfigWriter,
  search: Partial<Pick<SearchSettingsSnapshot, 'searxngBaseUrl'>>,
): Promise<void> {
  if (search.searxngBaseUrl !== undefined) {
    await writer.write(
      'search.searxngBaseUrl',
      search.searxngBaseUrl.trim(),
    );
  }
}
