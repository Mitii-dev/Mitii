import type {
  AgentSettingsPayload,
  McpToggles,
  ProviderSettingsPayload,
  ThunderSettingsPayload,
} from './payloads';

export function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Number.isFinite(value) ? Math.floor(value) : min, max));
}

export function resolveAutoContextWindow(
  _providerType: string,
  _model: string,
  requestedContextWindow: number,
  _previousContextWindow: number
): number {
  return clampInteger(requestedContextWindow, 1024, 1_000_000);
}

export function normalizeProviderSettings(
  settings: ProviderSettingsPayload,
  previousContextWindow: number
): ProviderSettingsPayload {
  const model = settings.model.trim();
  const normalized: ProviderSettingsPayload = {
    providerType: settings.providerType,
    baseUrl: settings.baseUrl.trim(),
    model,
    contextWindow: resolveAutoContextWindow(
      settings.providerType,
      model,
      settings.contextWindow,
      previousContextWindow
    ),
  };
  if (settings.apiVersion !== undefined) {
    normalized.apiVersion = settings.apiVersion.trim();
  }
  if (settings.region !== undefined) {
    normalized.region = settings.region.trim();
  }
  return normalized;
}

export interface ProviderValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateProviderSettings(settings: ProviderSettingsPayload): ProviderValidationResult {
  const errors: string[] = [];
  const providerType = settings.providerType;
  const baseUrl = settings.baseUrl.trim();
  const model = settings.model.trim();

  if (providerType !== 'echo' && !baseUrl) {
    errors.push('API base URL is required.');
  }
  if (providerType !== 'echo' && baseUrl) {
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push('API base URL must use http or https.');
      }
    } catch {
      errors.push('API base URL must be a valid URL.');
    }
  }
  if (!model) {
    errors.push(providerType === 'azure-openai' ? 'Azure deployment name is required.' : 'Model is required.');
  }
  if (providerType === 'azure-openai' && !settings.apiVersion?.trim()) {
    errors.push('Azure API version is required.');
  }
  if (providerType === 'bedrock' && !settings.region?.trim()) {
    errors.push('AWS region is required.');
  }
  if (!Number.isFinite(settings.contextWindow) || settings.contextWindow < 1024) {
    errors.push('Context window must be at least 1024 tokens.');
  }

  return { ok: errors.length === 0, errors };
}

export function normalizeAgentSettings(settings: AgentSettingsPayload): AgentSettingsPayload {
  return {
    ...settings,
    maxSteps: clampInteger(settings.maxSteps, 1, 100),
    askMaxSteps: clampInteger(settings.askMaxSteps, 1, 50),
    askMaxAutoContinues: clampInteger(settings.askMaxAutoContinues, 0, 10),
    maxAutoContinues: clampInteger(settings.maxAutoContinues, 0, 10),
    researchAgentMaxSteps: clampInteger(settings.researchAgentMaxSteps, 1, 50),
    planModel: settings.planModel.trim(),
    planBaseUrl: settings.planBaseUrl.trim(),
    actModel: settings.actModel.trim(),
    actBaseUrl: settings.actBaseUrl.trim(),
  };
}

export function normalizeThunderSettings(
  settings: ThunderSettingsPayload,
  previousContextWindow: number,
  builtinMcpToggles: McpToggles
): ThunderSettingsPayload {
  return {
    provider: normalizeProviderSettings(settings.provider, previousContextWindow),
    agent: normalizeAgentSettings(settings.agent),
    safety: settings.safety,
    mcp: {
      enabled: settings.mcp.enabled,
      builtinServers: builtinMcpToggles,
    },
    indexing: settings.indexing,
    telemetry: {
      sessionLogging: settings.telemetry.sessionLogging,
      debugMetrics: settings.telemetry.debugMetrics,
    },
  };
}
