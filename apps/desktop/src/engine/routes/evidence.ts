/** Desktop engine routes: evidence. */

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import {
  basename,
  join,
} from 'node:path';
import {
  findLatestModelIoLog,
  findLatestSessionLog,
  writeSessionExport,
  writeShareableDiagnostic,
} from '@mitii/host';
import {
  resolveLogsDir,
} from '../../shared/project-logs.js';
import {
  readDesktopSettingsJson,
} from '../startOptions.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetEvidenceSessionLogLatest(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const latest = findLatestSessionLog(cwd);
  if (!latest) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  sendJson(res, 200, { path: latest });
}

async function handlePostEvidenceSessionLogExport(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const fallback =
    resolveLogsDir(undefined, process.env) ?? join(cwd, '.mitii', 'logs');
  const outPath = writeSessionExport(
    cwd,
    fallback,
    body.payload ?? body,
  );
  sendJson(res, 200, { path: outPath });
}

async function handlePostEvidenceShareableDiagnostic(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const settings = readDesktopSettingsJson(process.env);
  const developer = settings?.developer as
    | Record<string, unknown>
    | undefined;
  const fallback =
    resolveLogsDir(undefined, process.env) ?? join(cwd, '.mitii', 'logs');
  const written = writeShareableDiagnostic({
    workspaceRoot: cwd,
    fallbackDir: fallback,
    meta: {
      providerType:
        typeof body.providerType === 'string'
          ? body.providerType
          : process.env.MITII_PROVIDER,
      model:
        typeof body.model === 'string'
          ? body.model
          : process.env.MITII_MODEL,
      baseUrl:
        typeof body.baseUrl === 'string'
          ? body.baseUrl
          : process.env.MITII_BASE_URL,
      mode: typeof body.mode === 'string' ? body.mode : undefined,
      developerEnabled: developer?.enabled === true,
      modelIoEnabled: developer?.modelIo === true,
      contextWindowTokens:
        typeof body.contextWindowTokens === 'number'
          ? body.contextWindowTokens
          : undefined,
    },
  });
  sendJson(res, 200, written);
}

async function handlePostEvidenceAuditPack(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const logsDir =
    resolveLogsDir(undefined, process.env) ?? join(cwd, '.mitii', 'logs');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const auditDir = join(logsDir, `audit-${stamp}`);
  mkdirSync(auditDir, { recursive: true });
  const copied: string[] = [];
  const candidates = [
    findLatestSessionLog(cwd),
    findLatestModelIoLog(cwd),
  ].filter((p): p is string => Boolean(p));
  // Also include newest shareable diagnostic if present.
  try {
    const names = readdirSync(logsDir)
      .filter((name) => name.startsWith('shareable-diagnostic-'))
      .sort();
    const last = names[names.length - 1];
    if (last) candidates.push(join(logsDir, last));
  } catch {
    /* ignore */
  }
  for (const src of candidates) {
    try {
      const dest = join(auditDir, basename(src));
      copyFileSync(src, dest);
      copied.push(dest);
    } catch {
      /* skip missing */
    }
  }
  sendJson(res, 200, { path: auditDir, copied });
}

export const evidenceRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/evidence/session-log/latest', handle: handleGetEvidenceSessionLogLatest },
  { method: 'POST', path: '/v1/evidence/session-log/export', handle: handlePostEvidenceSessionLogExport },
  { method: 'POST', path: '/v1/evidence/shareable-diagnostic', handle: handlePostEvidenceShareableDiagnostic },
  { method: 'POST', path: '/v1/evidence/audit-pack', handle: handlePostEvidenceAuditPack },
];
