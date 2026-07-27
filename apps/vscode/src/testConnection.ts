import { isLocalBaseUrl } from './providerPresets.js';

export interface ProviderConnectionResult {
  ok: boolean;
  message: string;
  models?: string[];
}

/**
 * Probe an OpenAI-compatible endpoint (Ollama, LM Studio, OpenAI, etc.).
 * Prefer GET /models; fall back to a tiny chat/completions ping.
 */
export async function testOpenAiCompatibleConnection(
  baseUrl: string,
  model: string,
  apiKey?: string,
): Promise<ProviderConnectionResult> {
  const root = baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {};
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  try {
    const modelsRes = await fetch(`${root}/models`, { headers });
    if (modelsRes.ok) {
      const data = (await modelsRes.json()) as { data?: Array<{ id: string }> };
      const models = data.data?.map((m) => m.id) ?? [];
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

    const probe = await fetch(`${root}/chat/completions`, {
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
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return {
        ok: false,
        message: `Cannot reach ${root}. Check the endpoint is running.`,
      };
    }
    return { ok: false, message: msg };
  }
}

export async function testProviderConnection(options: {
  type: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}): Promise<ProviderConnectionResult> {
  const { type, baseUrl, model, apiKey } = options;
  if (type === 'echo') {
    return { ok: true, message: 'Echo mode — no network connection required.' };
  }
  if (type !== 'openai-compatible') {
    return {
      ok: false,
      message: `Provider "${type}" is not supported yet. Use openai-compatible or echo.`,
    };
  }
  if (!baseUrl.trim()) {
    return { ok: false, message: 'Base URL is required for openai-compatible providers.' };
  }
  if (!model.trim()) {
    return { ok: false, message: 'Model is required.' };
  }
  // Local OpenAI-compatible servers (Ollama, LM Studio, etc.) do not need a key.
  // For remote URLs, still attempt the probe — many gateways accept anonymous
  // access; a 401/403 response surfaces a clearer "API key required" message.
  const result = await testOpenAiCompatibleConnection(
    baseUrl.trim(),
    model.trim(),
    apiKey,
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
