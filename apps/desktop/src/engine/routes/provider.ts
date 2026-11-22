/** Desktop engine routes: provider. */

import {
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  listProviderModels,
  pullOllamaModel,
  resolveModelCostRates,
  testProviderConnection,
} from '@mitii/host';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handlePostProviderTest(ctx: RouteContext): Promise<void> {
  const { req, res, token } = ctx;
  if (!requireAuth(req, res, token)) return;
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const type = String(body.type ?? process.env.MITII_PROVIDER ?? 'echo');
  const baseUrl =
    typeof body.baseUrl === 'string'
      ? body.baseUrl
      : process.env.MITII_BASE_URL;
  const model =
    typeof body.model === 'string'
      ? body.model
      : (process.env.MITII_MODEL ?? '');
  const apiKey =
    typeof body.apiKey === 'string' && body.apiKey.trim()
      ? body.apiKey.trim()
      : process.env.MITII_API_KEY ??
        process.env.MITII_ANTHROPIC_API_KEY ??
        process.env.MITII_GEMINI_API_KEY;
  const result = await testProviderConnection({
    type,
    ...(baseUrl ? { baseUrl } : {}),
    model,
    ...(apiKey ? { apiKey } : {}),
  });
  sendJson(res, 200, result);
}

async function handleGetModelPricing(ctx: RouteContext): Promise<void> {
  const { req, res, url, token } = ctx;
  if (!requireAuth(req, res, token)) return;
  const preset =
    url.searchParams.get('preset') ??
    url.searchParams.get('type') ??
    undefined;
  const model = url.searchParams.get('model') ?? undefined;
  const baseUrl = url.searchParams.get('baseUrl') ?? undefined;
  try {
    const rates = await resolveModelCostRates({
      presetOrType: preset,
      modelId: model,
      baseUrl,
    });
    sendJson(res, 200, { rates });
  } catch {
    sendJson(res, 200, { rates: null });
  }
}

async function handlePostProviderModels(ctx: RouteContext): Promise<void> {
  const { req, res, token } = ctx;
  if (!requireAuth(req, res, token)) return;
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const type = String(body.type ?? process.env.MITII_PROVIDER ?? 'echo');
  const baseUrl =
    typeof body.baseUrl === 'string'
      ? body.baseUrl
      : process.env.MITII_BASE_URL;
  const apiKey =
    typeof body.apiKey === 'string' && body.apiKey.trim()
      ? body.apiKey.trim()
      : process.env.MITII_API_KEY ??
        process.env.MITII_ANTHROPIC_API_KEY ??
        process.env.MITII_GEMINI_API_KEY;
  const models = await listProviderModels({
    type,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
  sendJson(res, 200, { models });
}

async function handlePostOllamaPull(ctx: RouteContext): Promise<void> {
  const { req, res, token } = ctx;
  if (!requireAuth(req, res, token)) return;
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const model =
    typeof body.model === 'string' && body.model.trim()
      ? body.model.trim()
      : DEFAULT_OLLAMA_EMBEDDING_MODEL;
  const baseUrl =
    typeof body.baseUrl === 'string' && body.baseUrl.trim()
      ? body.baseUrl.trim()
      : process.env.MITII_BASE_URL || 'http://127.0.0.1:11434/v1';

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'transfer-encoding': 'chunked',
  });
  res.write(
    `${JSON.stringify({ op: 'start', model })}\n`,
  );

  const result = await pullOllamaModel({
    model,
    baseUrl,
    onProgress: (progress) => {
      res.write(
        `${JSON.stringify({
          op: 'progress',
          status: progress.status,
          ...(progress.percent !== undefined
            ? { percent: progress.percent }
            : {}),
          ...(progress.total !== undefined ? { total: progress.total } : {}),
          ...(progress.completed !== undefined
            ? { completed: progress.completed }
            : {}),
        })}\n`,
      );
    },
  });

  if (result.ok) {
    res.write(
      `${JSON.stringify({ op: 'done', ok: true, model: result.model })}\n`,
    );
  } else {
    res.write(
      `${JSON.stringify({
        op: 'done',
        ok: false,
        error: result.reason,
      })}\n`,
    );
  }
  res.end();
}

export const providerRoutes: readonly Route[] = [
  { method: 'POST', path: '/v1/provider/test', handle: handlePostProviderTest },
  { method: 'GET', path: '/v1/model-pricing', handle: handleGetModelPricing },
  { method: 'POST', path: '/v1/provider/models', handle: handlePostProviderModels },
  { method: 'POST', path: '/v1/ollama/pull', handle: handlePostOllamaPull },
];
