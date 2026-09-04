import type { AutocompleteAuthHeader } from './settings.js';

export interface FimContextWindow {
  prefix: string;
  suffix: string;
}

export interface FimRequestInput extends FimContextWindow {
  model: string;
  maxTokens: number;
  temperature: number;
  metadata?: Readonly<Record<string, string>>;
}

export interface FimHttpConfig {
  baseUrl: string;
  endpointPath: string;
  authHeader: AutocompleteAuthHeader;
  apiKey?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface FimCompletionResponse {
  choices?: Array<{
    text?: string | null;
    message?: {
      content?: string | null;
    };
  }>;
}

const MAX_RETURNED_COMPLETION_CHARS = 12_000;

export function sliceFimContext(params: {
  text: string;
  offset: number;
  prefixChars: number;
  suffixChars: number;
}): FimContextWindow {
  const offset = Math.max(0, Math.min(params.text.length, params.offset));
  const prefixStart = Math.max(0, offset - params.prefixChars);
  const suffixEnd = Math.min(params.text.length, offset + params.suffixChars);
  return {
    prefix: params.text.slice(prefixStart, offset),
    suffix: params.text.slice(offset, suffixEnd),
  };
}

export function buildFimUrl(config: Pick<FimHttpConfig, 'baseUrl' | 'endpointPath'>): string {
  const root = config.baseUrl.trim().replace(/\/+$/, '');
  const endpointPath = config.endpointPath.trim().replace(/^\/+/, '');
  return new URL(`${root}/${endpointPath}`).toString();
}

export function buildFimHeaders(
  config: Pick<FimHttpConfig, 'authHeader' | 'apiKey'>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const key = config.apiKey?.trim();
  if (!key) return headers;
  if (config.authHeader === 'api-key') {
    headers['api-key'] = key;
  } else if (config.authHeader === 'x-api-key') {
    headers['x-api-key'] = key;
  } else {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

export function buildFimRequestBody(input: FimRequestInput): Record<string, unknown> {
  return {
    model: input.model,
    prompt: input.prefix,
    suffix: input.suffix,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    stream: false,
    ...(input.metadata && Object.keys(input.metadata).length > 0
      ? { metadata: input.metadata }
      : {}),
  };
}

export function extractFimChoiceText(response: FimCompletionResponse): string {
  const choice = response.choices?.[0];
  return choice?.text ?? choice?.message?.content ?? '';
}

export function sanitizeFimCompletion(params: {
  completion: string;
  suffix: string;
}): string {
  let text = params.completion
    .replace(/^```[\w-]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '');

  text = stripSuffixOverlap(text, params.suffix);
  text = text.replace(/\s+$/g, '');

  if (text.length > MAX_RETURNED_COMPLETION_CHARS) {
    return '';
  }
  if (looksLikeWholeFileReplacement(text)) {
    return '';
  }
  return text;
}

export function stripSuffixOverlap(completion: string, suffix: string): string {
  const max = Math.min(completion.length, suffix.length, 1_000);
  for (let size = max; size > 0; size -= 1) {
    if (completion.endsWith(suffix.slice(0, size))) {
      return completion.slice(0, completion.length - size);
    }
  }
  return completion;
}

export function mergeAbortSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function looksLikeWholeFileReplacement(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length < 80) return false;
  const importLike = lines.filter((line) =>
    /^\s*(import|export|package|using|#include|from\s+\S+\s+import)\b/.test(line),
  ).length;
  return importLike >= 8;
}
