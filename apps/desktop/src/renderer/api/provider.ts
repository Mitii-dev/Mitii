/** Provider connection, model listing, pricing and Ollama pulls. */

import {
  authHeaders,
} from './http.js';

export async function testConnection(options: {
  baseUrl: string;
  token?: string;
  type: string;
  providerBaseUrl?: string;
  model: string;
  apiKey?: string;
}): Promise<{ ok: boolean; message: string; models?: string[] }> {
  const res = await fetch(`${options.baseUrl}/v1/provider/test`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      type: options.type,
      baseUrl: options.providerBaseUrl,
      model: options.model,
      apiKey: options.apiKey,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`test_${res.status}:${text}`);
  }
  return (await res.json()) as {
    ok: boolean;
    message: string;
    models?: string[];
  };
}

export async function fetchProviderModels(options: {
  baseUrl: string;
  token?: string;
  type: string;
  providerBaseUrl?: string;
  apiKey?: string;
}): Promise<string[]> {
  const res = await fetch(`${options.baseUrl}/v1/provider/models`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      type: options.type,
      baseUrl: options.providerBaseUrl,
      apiKey: options.apiKey,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`models_${res.status}:${text}`);
  }
  const data = (await res.json()) as { models?: string[] };
  return Array.isArray(data.models)
    ? data.models.filter((id) => typeof id === 'string' && id.trim())
    : [];
}

export type OllamaPullStreamLine =
  | { op: 'start'; model: string }
  | {
      op: 'progress';
      status: string;
      percent?: number;
      total?: number;
      completed?: number;
    }
  | { op: 'done'; ok: true; model: string }
  | { op: 'done'; ok: false; error: string };

/**
 * Pull an Ollama model through the desktop engine (NDJSON progress).
 * Used for optional embedding upgrades such as nomic-embed-text.
 */
export async function* streamOllamaPull(options: {
  baseUrl: string;
  token?: string;
  model: string;
  providerBaseUrl?: string;
}): AsyncGenerator<OllamaPullStreamLine> {
  const res = await fetch(`${options.baseUrl}/v1/ollama/pull`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      model: options.model,
      baseUrl: options.providerBaseUrl,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`ollama_pull_${res.status}:${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        yield JSON.parse(line) as OllamaPullStreamLine;
      }
      newline = buffer.indexOf('\n');
    }
  }
  const tail = buffer.trim();
  if (tail) {
    yield JSON.parse(tail) as OllamaPullStreamLine;
  }
}

export async function pullOllamaEmbeddingModel(options: {
  baseUrl: string;
  token?: string;
  model: string;
  providerBaseUrl?: string;
  onProgress?: (progress: {
    status: string;
    percent?: number;
  }) => void;
}): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  let lastError = 'Ollama pull failed.';
  for await (const line of streamOllamaPull(options)) {
    if (line.op === 'progress') {
      options.onProgress?.({
        status: line.status,
        ...(line.percent !== undefined ? { percent: line.percent } : {}),
      });
    } else if (line.op === 'done') {
      if (line.ok) {
        return { ok: true, model: line.model };
      }
      return { ok: false, error: line.error };
    }
  }
  return { ok: false, error: lastError };
}

export async function fetchModelPricing(options: {
  baseUrl: string;
  token?: string;
  preset?: string;
  model?: string;
  providerBaseUrl?: string;
}): Promise<{
  rates: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    reasoning?: number;
  } | null;
}> {
  const params = new URLSearchParams();
  if (options.preset) params.set('preset', options.preset);
  if (options.model) params.set('model', options.model);
  if (options.providerBaseUrl) params.set('baseUrl', options.providerBaseUrl);
  const res = await fetch(
    `${options.baseUrl}/v1/model-pricing?${params.toString()}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) return { rates: null };
  return (await res.json()) as Awaited<ReturnType<typeof fetchModelPricing>>;
}
