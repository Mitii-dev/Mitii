/**
 * Pull an Ollama model via the native /api/pull endpoint.
 * Used by desktop Semantic index for optional embedding upgrades
 * (e.g. nomic-embed-text) that are not shipped with Mitii.
 */

export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  /** 0–100 when total/completed are known. */
  percent?: number;
}

export interface PullOllamaModelInput {
  /** OpenAI-compatible root (…/v1) or Ollama origin. Defaults to localhost. */
  baseUrl?: string;
  model: string;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: OllamaPullProgress) => void;
  /** Abort after this many ms (default: none). */
  timeoutMs?: number;
}

export type PullOllamaModelResult =
  | { ok: true; model: string }
  | { ok: false; reason: string };

const DEFAULT_OLLAMA_ORIGIN = 'http://127.0.0.1:11434';

/**
 * Resolve an Ollama HTTP origin from an OpenAI-compatible base URL.
 * `http://localhost:11434/v1` → `http://localhost:11434`
 */
export function resolveOllamaApiOrigin(baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return DEFAULT_OLLAMA_ORIGIN;
  }
  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return trimmed.replace(/\/$/, '').replace(/\/v1$/i, '') || DEFAULT_OLLAMA_ORIGIN;
  }
}

/**
 * True when `wanted` is present in an Ollama tags list
 * (`nomic-embed-text` matches `nomic-embed-text:latest`, etc.).
 */
export function isOllamaModelInstalled(
  installedModels: readonly string[],
  wanted: string,
): boolean {
  const target = normalizeOllamaTag(wanted);
  if (!target) return false;
  return installedModels.some((id) => {
    const candidate = normalizeOllamaTag(id);
    if (!candidate) return false;
    if (candidate === target) return true;
    if (candidate.startsWith(`${target}:`)) return true;
    if (target.startsWith(`${candidate}:`)) return true;
    return false;
  });
}

function normalizeOllamaTag(id: string): string {
  const trimmed = id.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.endsWith(':latest') ? trimmed.slice(0, -':latest'.length) : trimmed;
}

/**
 * Pull a model through Ollama's streaming /api/pull API.
 */
export async function pullOllamaModel(
  input: PullOllamaModelInput,
): Promise<PullOllamaModelResult> {
  const model = input.model.trim();
  if (!model) {
    return { ok: false, reason: 'Model name is required.' };
  }

  const origin = resolveOllamaApiOrigin(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer =
    typeof input.timeoutMs === 'number' && input.timeoutMs > 0
      ? setTimeout(() => controller.abort(), input.timeoutMs)
      : undefined;

  try {
    const response = await fetchImpl(`${origin}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        reason:
          text.trim() ||
          `Ollama pull failed (${response.status}). Is Ollama running at ${origin}?`,
      };
    }

    if (!response.body) {
      // Non-streaming fallback body
      const data = (await response.json().catch(() => null)) as {
        status?: string;
        error?: string;
      } | null;
      if (data?.error) {
        return { ok: false, reason: data.error };
      }
      input.onProgress?.({ status: data?.status ?? 'success', percent: 100 });
      return { ok: true, model };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastError: string | undefined;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const parsed = parsePullLine(line);
          if (parsed.error) {
            lastError = parsed.error;
          }
          input.onProgress?.(parsed.progress);
        }
        newline = buffer.indexOf('\n');
      }
    }

    const tail = buffer.trim();
    if (tail) {
      const parsed = parsePullLine(tail);
      if (parsed.error) {
        lastError = parsed.error;
      }
      input.onProgress?.(parsed.progress);
    }

    if (lastError) {
      return { ok: false, reason: lastError };
    }

    return { ok: true, model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/abort/i.test(message)) {
      return { ok: false, reason: 'Ollama pull timed out or was cancelled.' };
    }
    return {
      ok: false,
      reason: `Could not reach Ollama at ${origin}. Is it installed and running? (${message})`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parsePullLine(line: string): {
  progress: OllamaPullProgress;
  error?: string;
} {
  try {
    const data = JSON.parse(line) as {
      status?: string;
      digest?: string;
      total?: number;
      completed?: number;
      error?: string;
    };
    const total = typeof data.total === 'number' ? data.total : undefined;
    const completed =
      typeof data.completed === 'number' ? data.completed : undefined;
    const percent =
      total && total > 0 && completed !== undefined
        ? Math.min(100, Math.round((completed / total) * 100))
        : data.status === 'success'
          ? 100
          : undefined;
    return {
      progress: {
        status: data.status ?? (data.error ? 'error' : 'pulling'),
        ...(data.digest ? { digest: data.digest } : {}),
        ...(total !== undefined ? { total } : {}),
        ...(completed !== undefined ? { completed } : {}),
        ...(percent !== undefined ? { percent } : {}),
      },
      ...(data.error ? { error: data.error } : {}),
    };
  } catch {
    return { progress: { status: line } };
  }
}
