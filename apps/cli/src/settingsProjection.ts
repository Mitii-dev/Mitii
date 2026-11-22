/**
 * CLI owns a curated projection of host config (`.mitii/config.json`), not the
 * full `mitii.*` settings tree. This module names that projection and maps each
 * curated key to the shared catalog entry it corresponds to.
 */

/** Keys the CLI persists in `.mitii/config.json`. */
export const CLI_CURATED_CONFIG_KEYS = [
  'provider',
  'providerPreset',
  'model',
  'baseUrl',
  'searxngBaseUrl',
  'embeddingBackend',
  'embeddingSource',
  'embeddingModel',
  'embeddingDimensions',
  'workspaceId',
  'defaultMode',
  'contextWindowTokens',
  'loopPolicy',
] as const;

export type CliCuratedConfigKey = (typeof CLI_CURATED_CONFIG_KEYS)[number];

/**
 * Curated key → catalog key (documentation / tooling). `null` marks CLI-only
 * keys with no catalog entry; a trailing `.*` marks a nested lab block.
 */
export const CLI_CURATED_TO_CATALOG: Readonly<
  Record<CliCuratedConfigKey, string | null>
> = {
  provider: 'mitii.provider.type',
  providerPreset: 'mitii.provider.preset',
  model: 'mitii.provider.model',
  baseUrl: 'mitii.provider.baseUrl',
  searxngBaseUrl: 'mitii.search.searxngBaseUrl',
  embeddingSource: 'mitii.semanticIndex.source',
  embeddingModel: 'mitii.semanticIndex.model',
  embeddingDimensions: 'mitii.semanticIndex.dimensions',
  contextWindowTokens: 'mitii.provider.contextWindow',
  loopPolicy: 'mitii.loopPolicy.*',
  embeddingBackend: null,
  workspaceId: null,
  defaultMode: null,
};
