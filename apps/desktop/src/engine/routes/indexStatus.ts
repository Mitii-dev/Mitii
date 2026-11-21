/** Desktop engine routes: indexStatus. */

import {
  join,
} from 'node:path';
import {
  appendDesktopLog,
  errorMessage,
  resolveLogsDir,
} from '../../shared/project-logs.js';
import {
  getIndexStatus,
  pauseWorkspaceIndex,
  reindexWorkspace,
} from '../index-status.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';
import {
  resolveDesktopIndexConcurrency,
} from '../explorer/desktopIndex.js';

async function handleGetIndexStatus(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  sendJson(res, 200, getIndexStatus(cwd));
}

async function handlePostIndexPause(ctx: RouteContext): Promise<void> {
  const { req, res, token } = ctx;
  if (!requireAuth(req, res, token)) return;
  sendJson(res, 200, pauseWorkspaceIndex());
}

async function handlePostIndexReindex(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const maximumFiles =
    typeof body.maximumFiles === 'number' && body.maximumFiles > 0
      ? Math.floor(body.maximumFiles)
      : undefined;
  const semantic = body.semanticIndex as
    | {
        enabled?: boolean;
        source?: string;
        model?: string;
        dimensions?: number;
        normalized?: boolean;
        baseUrl?: string;
      }
    | undefined;
  const stream =
    body.stream === true ||
    String(req.headers.accept ?? '').includes(
      'application/x-ndjson',
    );
  const force = body.force === true;
  const concurrency =
    typeof body.concurrency === 'number' && body.concurrency > 0
      ? Math.min(32, Math.floor(body.concurrency))
      : resolveDesktopIndexConcurrency();
  const filePaths = Array.isArray(body.filePaths)
    ? body.filePaths.filter(
        (p): p is string => typeof p === 'string' && p.length > 0,
      )
    : undefined;
  const semanticIndex = semantic
    ? {
        enabled: semantic.enabled === true,
        source: semantic.source as never,
        model: semantic.model ?? '',
        dimensions: semantic.dimensions ?? 0,
        normalized: semantic.normalized !== false,
        baseUrl: semantic.baseUrl ?? process.env.MITII_BASE_URL ?? '',
        apiKey: process.env.MITII_API_KEY,
      }
    : {
        enabled: false,
        source: 'bundled' as const,
        model: '',
        dimensions: 0,
        normalized: true,
        baseUrl: '',
      };

  if (stream) {
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const writeLine = (obj: unknown) => {
      if (res.writableEnded) return;
      try {
        res.write(`${JSON.stringify(obj)}\n`);
      } catch {
        /* client gone */
      }
    };
    try {
      const result = await reindexWorkspace({
        workspaceRoot: cwd,
        maximumFiles,
        concurrency,
        force,
        ...(filePaths?.length ? { filePaths } : {}),
        semanticIndex,
        onProgress: (progress) => {
          writeLine({
            type: 'progress',
            stage: progress.stage,
            message: progress.message,
            percent: progress.percent,
            fileCount: progress.fileCount,
            lexicalReady: progress.lexicalReady,
            embeddingPhase: progress.embeddingPhase,
          });
        },
      });
      writeLine({
        type: 'result',
        ...result,
        statusSnapshot: getIndexStatus(cwd),
      });
    } catch (error) {
      const message = errorMessage(error);
      appendDesktopLog(
        resolveLogsDir(undefined, process.env) ??
          join(cwd, '.mitii', 'logs'),
        'indexing',
        `reindex_stream_failed ${message}`,
        { level: 'error', mirrorRuns: true },
      );
      writeLine({
        type: 'error',
        message,
        statusSnapshot: getIndexStatus(cwd),
      });
    }
    res.end();
    return;
  }

  try {
    const result = await reindexWorkspace({
      workspaceRoot: cwd,
      maximumFiles,
      concurrency,
      force,
      ...(filePaths?.length ? { filePaths } : {}),
      semanticIndex,
    });
    sendJson(res, 200, { ...result, statusSnapshot: getIndexStatus(cwd) });
  } catch (error) {
    const message = errorMessage(error);
    appendDesktopLog(
      resolveLogsDir(undefined, process.env) ??
        join(cwd, '.mitii', 'logs'),
      'indexing',
      `reindex_failed ${message}`,
      { level: 'error', mirrorRuns: true },
    );
    sendJson(res, 500, {
      op: 'error',
      error: 'internal',
      message,
      statusSnapshot: getIndexStatus(cwd),
    });
  }
}

export const indexStatusRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/index/status', handle: handleGetIndexStatus },
  { method: 'POST', path: '/v1/index/pause', handle: handlePostIndexPause },
  { method: 'POST', path: '/v1/index/reindex', handle: handlePostIndexReindex },
];
