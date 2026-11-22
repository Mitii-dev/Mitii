/** Config UX — provider presets, LlmPort factory, connection probe, context window, pricing. */

export {
  PROVIDER_PRESETS,
  getProviderPreset,
  isHostProviderType,
  isLocalBaseUrl,
  isOllamaBaseUrl,
  isOllamaCloudBaseUrl,
  normalizeOllamaModelId,
} from '../config/providerPresets.js';
export type {
  HostProviderType,
  ProviderPreset,
  ProviderPresetId,
} from '../config/providerPresets.js';

export { createHostLlmPorts } from '../config/createHostLlmPorts.js';
export type {
  CreateHostLlmPortsInput,
  HostLlmPorts,
} from '../config/createHostLlmPorts.js';

export {
  DEFAULT_CONTEXT_WINDOW,
  clampMaximumOutputTokensToContext,
  inferContextWindowFromModelId,
  inferMaximumOutputTokensFromModelId,
  parseContextWindowTokens,
  resolveEffectiveContextWindow,
  resolveHostContextWindowTokens,
} from '../config/resolveEffectiveContextWindow.js';

export {
  inferHostProviderType,
  resolveProviderApiKey,
} from '../config/resolveProviderApiKey.js';

export {
  testProviderConnection,
  listProviderModels,
} from '../config/testProviderConnection.js';
export type {
  ProviderConnectionResult,
  TestProviderConnectionInput,
  ListProviderModelsInput,
} from '../config/testProviderConnection.js';

export {
  pullOllamaModel,
  isOllamaModelInstalled,
  resolveOllamaApiOrigin,
} from '../config/pullOllamaModel.js';
export type {
  OllamaPullProgress,
  PullOllamaModelInput,
  PullOllamaModelResult,
} from '../config/pullOllamaModel.js';

export {
  MODELS_DEV_API_URL,
  modelsDevProviderId,
  isPricedCloudProvider,
  lookupModelCostRates,
  estimateSessionCost,
  formatUsd,
  clearModelsDevPricingCache,
  getCachedModelsDevCatalog,
  fetchModelsDevCatalog,
  resolveModelCostRates,
} from '@mitii/ui-core';
export type {
  ModelCostRates,
  TokenCostUsage,
  SessionCostEstimate,
  ModelsDevCatalog,
  ModelsDevPricingCache,
} from '@mitii/ui-core';
