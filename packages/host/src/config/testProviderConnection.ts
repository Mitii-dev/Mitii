import {
  getProviderPreset,
  isLocalBaseUrl,
  isOllamaBaseUrl,
  PROVIDER_PRESETS,
} from './providerPresets.js';

export interface ProviderConnectionResult {
  ok: boolean;
  message: string;
  models?: string[];
}

export interface TestProviderConnectionInput {
  type: string;
  baseUrl?: string;
  model: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface ListProviderModelsInput {
  type: string;
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Abort catalog listing after this many ms (default 8000). */
  timeoutMs?: number;
}

/**
 * Probe a configured provider without executing an agent run.
 */
export async function testProviderConnection(
  input: TestProviderConnectionInput,
): Promise<ProviderConnectionResult> {
  const { type, model, apiKey } = input;
  const preset = getProviderPreset(type);
  const baseUrl = input.baseUrl?.trim() || preset?.baseUrl || '';

  if (type === 'echo') {
    return { ok: true, message: 'Echo mode — no network connection required.' };
  }

  if (!model.trim()) {
    return { ok: false, message: 'Model is required.' };
  }

  if (type === 'anthropic') {
    if (!apiKey?.trim()) {
      return { ok: false, message: 'Anthropic (Claude) requires an API key.' };
    }
    return testAnthropicConnection(baseUrl, model.trim(), apiKey.trim(), input.fetchImpl);
  }

  if (type === 'gemini') {
    if (!apiKey?.trim()) {
      return { ok: false, message: 'Gemini requires an API key.' };
    }
    return testGeminiConnection(baseUrl, model.trim(), apiKey.trim(), input.fetchImpl);
  }

  if (type !== 'openai-compatible') {
    return {
      ok: false,
      message: `Provider "${type}" is not supported. Use echo, openai-compatible, anthropic, or gemini.`,
    };
  }

  if (!baseUrl) {
    return { ok: false, message: 'Base URL is required for openai-compatible providers.' };
  }

  const result = await testOpenAiCompatibleConnection(
    baseUrl,
    model.trim(),
    apiKey,
    input.fetchImpl,
  );
  if (
    !result.ok &&
    !apiKey?.trim() &&
    !isLocalBaseUrl(baseUrl) &&
    /401|403|unauthorized|api[_ ]?key|authentication|bearer/i.test(result.message)
  ) {
    return {
      ok: false,
      message: 'Cloud OpenAI-compatible endpoints require an API key.',
    };
  }
  return result;
}

/**
 * List models from the configured provider. Used to populate the settings
 * dropdown without requiring a manual Test connection click.
 */
export async function listProviderModels(
  input: ListProviderModelsInput,
): Promise<string[]> {
  const { type, apiKey } = input;
  const preset = getProviderPreset(type);
  const baseUrl = input.baseUrl?.trim() || preset?.baseUrl || '';
  const fetchImpl = input.fetchImpl ?? fetch;

  if (type === 'echo' || !baseUrl) {
    return [];
  }

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 8_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  const fetchWithTimeout: typeof fetch = (url, init) =>
    fetchImpl(url, { ...init, signal: init?.signal ?? signal });

  try {
    if (type === 'anthropic') {
      if (!apiKey?.trim()) return [];
      const root = baseUrl.replace(/\/$/, '');
      const modelsRes = await fetchWithTimeout(`${root}/v1/models`, {
        headers: {
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
        },
      });
      if (!modelsRes.ok) return [];
      const data = (await modelsRes.json()) as { data?: Array<{ id: string }> };
      return uniqueModelIds(data.data?.map((item) => item.id) ?? []);
    }

    if (type === 'gemini') {
      if (!apiKey?.trim()) return [];
      const root = baseUrl.replace(/\/$/, '');
      const modelsRes = await fetchWithTimeout(`${root}/v1beta/models`, {
        headers: { 'x-goog-api-key': apiKey.trim() },
      });
      if (!modelsRes.ok) return [];
      const data = (await modelsRes.json()) as {
        models?: Array<{ name?: string }>;
      };
      return uniqueModelIds(
        data.models
          ?.map((item) => item.name?.replace(/^models\//, ''))
          .filter((id): id is string => Boolean(id)) ?? [],
      );
    }

    if (type !== 'openai-compatible') {
      return [];
    }

    const root = baseUrl.replace(/\/$/, '');
    const headers = openAiCompatibleAuthHeaders(root, apiKey);
    return await listOpenAiCompatibleModels(root, headers, fetchWithTimeout);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function listOpenAiCompatibleModels(
  root: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const catalogUrls = openAiCompatibleCatalogUrls(root);
  for (const url of catalogUrls) {
    const modelsRes = await fetchImpl(url, { headers }).catch(() => undefined);
    if (!modelsRes?.ok) {
      continue;
    }
    const data = (await modelsRes.json()) as {
      data?: Array<{ id?: string }>;
    };
    const models = uniqueModelIds(
      data.data?.map((item) => item.id).filter((id): id is string => Boolean(id)) ??
        [],
    );
    if (models.length > 0) {
      return models;
    }
  }

  if (!isOllamaBaseUrl(root) && !isLocalBaseUrl(root)) {
    return [];
  }

  const tagsUrl = ollamaTagsUrl(root);
  const tagsRes = await fetchImpl(tagsUrl).catch(() => undefined);
  if (!tagsRes?.ok) {
    return [];
  }
  const tags = (await tagsRes.json()) as {
    models?: Array<{ name?: string; model?: string }>;
  };
  return uniqueModelIds(
    (tags.models ?? [])
      .map((item) => item.name || item.model)
      .filter((id): id is string => Boolean(id)),
  );
}

function openAiCompatibleAuthHeaders(
  baseUrl: string,
  apiKey?: string,
): Record<string, string> {
  if (!apiKey?.trim()) {
    return {};
  }
  const key = apiKey.trim();
  const authHeader =
    matchPresetForBaseUrl(baseUrl)?.authHeader ??
    (isAzureOpenAiUrl(baseUrl) ? 'api-key' : 'authorization');
  if (authHeader === 'api-key') {
    return { 'api-key': key };
  }
  if (authHeader === 'x-api-key') {
    return { 'x-api-key': key };
  }
  return { Authorization: `Bearer ${key}` };
}

function openAiCompatibleCatalogUrls(root: string): string[] {
  const azure = azureModelsUrl(root);
  if (azure) {
    return [azure];
  }
  return [`${root.replace(/\/$/, '')}/models`];
}

function azureModelsUrl(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl);
    if (!isAzureOpenAiUrl(baseUrl)) {
      return undefined;
    }
    const version =
      url.searchParams.get('api-version') ??
      /[?&]api-version=([^&]+)/.exec(baseUrl)?.[1] ??
      '2024-06-01';
    return `${url.origin}/openai/models?api-version=${encodeURIComponent(version)}`;
  } catch {
    return undefined;
  }
}

function isAzureOpenAiUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase().endsWith('.openai.azure.com');
  } catch {
    return /openai\.azure\.com/i.test(baseUrl);
  }
}

function matchPresetForBaseUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '').toLowerCase();
  return PROVIDER_PRESETS.find(
    (preset) =>
      preset.baseUrl &&
      preset.baseUrl.replace(/\/+$/, '').toLowerCase() === normalized,
  );
}

function ollamaTagsUrl(openAiRoot: string): string {
  const origin = openAiRoot.replace(/\/$/, '').replace(/\/v1$/i, '');
  return `${origin}/api/tags`;
}

function uniqueModelIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    models.push(trimmed);
  }
  return models;
}

async function testOpenAiCompatibleConnection(
  baseUrl: string,
  model: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderConnectionResult> {
  const root = baseUrl.replace(/\/$/, '');
  const headers = openAiCompatibleAuthHeaders(root, apiKey);

  try {
    const models = await listOpenAiCompatibleModels(root, headers, fetchImpl);
    if (models.length > 0) {
      const hasModel =
        models.length === 0 ||
        models.some((m) => m === model || m.startsWith(`${model}:`) || model.startsWith(m));
      if (!hasModel && models.length > 0) {
        return {
          ok: false,
          message: `Connected, but model "${model}" not found. Available: ${models.slice(0, 8).join(', ')}`,
          models,
        };
      }
      return {
        ok: true,
        message: `Connected to ${root}. Model "${model}"${models.length ? ' found' : ' (could not list models)'}.`,
        models,
      };
    }

    const probe = await fetchImpl(`${root}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
        stream: false,
      }),
    });

    if (probe.ok) {
      return { ok: true, message: `Connected. Model "${model}" responded.` };
    }

    const errText = await probe.text().catch(() => '');
    if (probe.status === 404) {
      return { ok: false, message: `Model "${model}" not found.` };
    }
    return {
      ok: false,
      message: `Connection failed (${probe.status}): ${errText.slice(0, 150)}`,
    };
  } catch (error) {
    return toNetworkError(error, root);
  }
}

async function testAnthropicConnection(
  baseUrl: string,
  model: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderConnectionResult> {
  const root = (baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };

  try {
    const modelsRes = await fetchImpl(`${root}/v1/models`, { headers });
    if (modelsRes.ok) {
      const data = (await modelsRes.json()) as {
        data?: Array<{ id: string }>;
      };
      const models = data.data?.map((m) => m.id) ?? [];
      const hasModel =
        models.length === 0 ||
        models.some((id) => id === model || id.startsWith(model) || model.startsWith(id));
      if (!hasModel && models.length > 0) {
        return {
          ok: false,
          message: `Connected, but model "${model}" not found. Available: ${models.slice(0, 8).join(', ')}`,
          models,
        };
      }
      return {
        ok: true,
        message: `Connected to Anthropic. Model "${model}"${models.length ? ' found' : ' (could not list models)'}.`,
        models,
      };
    }

    const probe = await fetchImpl(`${root}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (probe.ok) {
      return { ok: true, message: `Connected. Model "${model}" responded.` };
    }
    const errText = await probe.text().catch(() => '');
    if (probe.status === 401 || probe.status === 403) {
      return { ok: false, message: 'Authentication failed. Check your Anthropic API key.' };
    }
    return {
      ok: false,
      message: `Connection failed (${probe.status}): ${errText.slice(0, 150)}`,
    };
  } catch (error) {
    return toNetworkError(error, root);
  }
}

async function testGeminiConnection(
  baseUrl: string,
  model: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderConnectionResult> {
  const root = (baseUrl || 'https://generativelanguage.googleapis.com').replace(
    /\/$/,
    '',
  );
  const modelId = model.startsWith('models/') ? model.slice('models/'.length) : model;
  const headers = {
    'x-goog-api-key': apiKey,
    'Content-Type': 'application/json',
  };

  try {
    const modelsRes = await fetchImpl(`${root}/v1beta/models`, { headers });
    if (modelsRes.ok) {
      const data = (await modelsRes.json()) as {
        models?: Array<{ name?: string }>;
      };
      const models =
        data.models
          ?.map((item) => item.name?.replace(/^models\//, ''))
          .filter((id): id is string => Boolean(id)) ?? [];
      const hasModel =
        models.length === 0 ||
        models.some((id) => id === modelId || id.startsWith(modelId) || modelId.startsWith(id));
      if (!hasModel && models.length > 0) {
        return {
          ok: false,
          message: `Connected, but model "${model}" not found. Available: ${models.slice(0, 8).join(', ')}`,
          models,
        };
      }
      return {
        ok: true,
        message: `Connected to Gemini. Model "${model}"${models.length ? ' found' : ' (could not list models)'}.`,
        models,
      };
    }

    const probe = await fetchImpl(
      `${root}/v1beta/models/${modelId}:generateContent`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      },
    );
    if (probe.ok) {
      return { ok: true, message: `Connected. Model "${model}" responded.` };
    }
    const errText = await probe.text().catch(() => '');
    if (probe.status === 401 || probe.status === 403) {
      return { ok: false, message: 'Authentication failed. Check your Gemini API key.' };
    }
    return {
      ok: false,
      message: `Connection failed (${probe.status}): ${errText.slice(0, 150)}`,
    };
  } catch (error) {
    return toNetworkError(error, root);
  }
}

function toNetworkError(error: unknown, root: string): ProviderConnectionResult {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
    return {
      ok: false,
      message: `Cannot reach ${root}. Check the endpoint is running.`,
    };
  }
  return { ok: false, message: msg };
}
