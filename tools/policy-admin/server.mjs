#!/usr/bin/env node
/**
 * Simple HTML Policy Admin for Mitii ship bands.
 *
 *   pnpm policy-admin
 *   → http://127.0.0.1:8787
 *
 * Save writes packages/v8 loopPolicyBands.ts + windowBudgetBands.ts.
 * Rebuild @mitii/v8 yourself before packaging.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BANDS,
  LOOP_FIELDS,
  WINDOW_FIELDS,
  asNumberRecord,
} from './catalog.mjs';
import { writeShipBandSources, deltasFromBase } from './shipWriter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const PUBLIC = join(__dirname, 'public');
const PORT = Number(process.env.POLICY_ADMIN_PORT || 8787);
const HOST = process.env.POLICY_ADMIN_HOST || '127.0.0.1';

const LOOP_SRC = join(
  ROOT,
  'packages/v8/src/engine/agent-engine/policy/loopPolicyBands.ts',
);
const WINDOW_SRC = join(
  ROOT,
  'packages/v8/src/modules/window-budget/windowBudgetBands.ts',
);
const POLICY_SRC = join(ROOT, 'packages/v8/src/engine/agent-engine/policy.ts');
const DEFAULTS_SRC = join(
  ROOT,
  'packages/v8/src/modules/window-budget/defaults.ts',
);

/** Parse `export const NAME[: Type] = { ... }` from a TS source file. */
function extractConstObject(filePath, name) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${filePath}`);
  }
  const source = readFileSync(filePath, 'utf8');
  const marker = `export const ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Could not find ${name} in ${filePath}`);
  const afterName = start + marker.length;
  const eq = source.indexOf('=', afterName);
  if (eq < 0 || eq - afterName > 200) {
    throw new Error(`Could not find assignment for ${name}`);
  }
  const brace = source.indexOf('{', eq);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`Unclosed object for ${name}`);
  const literal = source.slice(brace, end);
  return Function(`"use strict"; return (${literal});`)();
}

function bandOverrides(table, band) {
  return asNumberRecord(table?.[band]?.overrides ?? {});
}

function resolveBand(contextWindowTokens) {
  const w = Math.floor(contextWindowTokens);
  if (!Number.isFinite(w) || w <= 0) return 'compact';
  if (w < 50_000) return 'compact';
  if (w < 100_000) return 'standard';
  return 'wide';
}

function mergePolicy(base, overlay) {
  return { ...base, ...overlay };
}

/** Lightweight preview (matches DeriveWindowPolicy capacity math at medium effort). */
function previewPolicy(contextWindowTokens, baseWindow, windowOverlay) {
  const p = mergePolicy(baseWindow, windowOverlay);
  const W = Math.max(1, Math.floor(contextWindowTokens));
  const outputReserve = Math.max(
    Math.floor(p.outputMinTokens),
    Math.floor(W * p.outputRatio),
  );
  const usable = Math.max(0, W - outputReserve);
  const windowFiles = Math.floor(
    (W * p.outputRatio) / Math.max(1, p.filesPerOutputTokens),
  );
  const files = Math.min(
    Math.floor(p.maxUniqueFilesPerCallCap),
    Math.max(Math.floor(p.minUniqueFilesPerCall), windowFiles),
  );
  // Medium effort overlay typically caps files at 8 — show both.
  const effortCap = 8;
  const filesAfterEffort = Math.min(files, effortCap);
  const skills = Math.min(
    Math.floor(p.maxSkillsCap),
    Math.max(
      Math.floor(p.maxSkillsBase),
      Math.floor(usable / Math.max(1, p.skillsPerUsableTokens)),
    ),
  );
  return {
    contextWindowTokens: W,
    usableInputTokens: usable,
    maximumOutputTokens: outputReserve,
    maxUniqueFilesPerCall: filesAfterEffort,
    maxUniqueFilesBeforeEffort: files,
    maxSkills: skills,
    skillsTokens: Math.floor(usable * p.skillsShare),
    repositoryTokens: Math.floor(usable * p.repositoryShare),
    conversationTokens: Math.floor(usable * p.conversationShare),
    maxVerificationChecks: Math.min(
      Math.floor(p.verificationChecksMax),
      Math.max(
        Math.floor(p.verificationChecksBase),
        Math.floor(usable / Math.max(1, p.verificationChecksPerUsableTokens)),
      ),
    ),
  };
}

function emptyMaps() {
  return {
    loop: { compact: {}, standard: {}, wide: {} },
    window: { compact: {}, standard: {}, wide: {} },
  };
}

function readState() {
  const loopTable = extractConstObject(LOOP_SRC, 'LOOP_POLICY_WINDOW_BAND_TABLE');
  const windowTable = extractConstObject(
    WINDOW_SRC,
    'WINDOW_BUDGET_BAND_TABLE',
  );
  const AGENT_ENGINE_THRESHOLDS = extractConstObject(
    POLICY_SRC,
    'AGENT_ENGINE_THRESHOLDS',
  );
  const DEFAULT_WINDOW_BUDGET_POLICY = extractConstObject(
    DEFAULTS_SRC,
    'DEFAULT_WINDOW_BUDGET_POLICY',
  );

  const tables = emptyMaps();
  for (const band of ['compact', 'standard', 'wide']) {
    tables.loop[band] = bandOverrides(loopTable, band);
    tables.window[band] = bandOverrides(windowTable, band);
  }

  const baseLoop = asNumberRecord(AGENT_ENGINE_THRESHOLDS);
  const baseWindow = asNumberRecord(DEFAULT_WINDOW_BUDGET_POLICY);

  const previews = {};
  for (const band of BANDS) {
    const w = band.exampleWindows[1] ?? band.exampleWindows[0];
    // Preview uses the band that matches the example window, with that band's overlays.
    const resolved = resolveBand(w);
    previews[band.id] = previewPolicy(
      w,
      baseWindow,
      tables.window[resolved],
    );
  }

  return {
    bands: BANDS,
    loopFields: LOOP_FIELDS,
    windowFields: WINDOW_FIELDS,
    baseLoop,
    baseWindow,
    tables,
    previews,
    paths: {
      loop: 'packages/v8/src/engine/agent-engine/policy/loopPolicyBands.ts',
      window: 'packages/v8/src/modules/window-budget/windowBudgetBands.ts',
    },
  };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendFile(res, filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  const type = types[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(readFileSync(filePath));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function cleanTables(tables, baseLoop, baseWindow) {
  const out = emptyMaps();
  for (const band of ['compact', 'standard', 'wide']) {
    out.loop[band] = deltasFromBase(tables.loop?.[band], baseLoop);
    out.window[band] = deltasFromBase(tables.window?.[band], baseWindow);
  }
  return out;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return sendJson(res, 200, readState());
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      const body = await readBody(req);
      const baseLoop = asNumberRecord(
        extractConstObject(POLICY_SRC, 'AGENT_ENGINE_THRESHOLDS'),
      );
      const baseWindow = asNumberRecord(
        extractConstObject(DEFAULTS_SRC, 'DEFAULT_WINDOW_BUDGET_POLICY'),
      );
      const tables = cleanTables(body.tables ?? {}, baseLoop, baseWindow);
      const written = writeShipBandSources({ monorepoRoot: ROOT, tables });
      return sendJson(res, 200, {
        ok: true,
        message: 'Saved ship band sources. Run: pnpm --filter @mitii/v8 build',
        ...written,
        tables,
      });
    }

    if (req.method === 'GET') {
      let path = url.pathname === '/' ? '/index.html' : url.pathname;
      const filePath = join(PUBLIC, path.replace(/^\//, ''));
      if (!filePath.startsWith(PUBLIC) || !existsSync(filePath)) {
        res.writeHead(404);
        return res.end('Not found');
      }
      return sendFile(res, filePath);
    }

    res.writeHead(405);
    res.end('Method not allowed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: message });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('  Mitii Policy Admin');
  console.log(`  ${url}`);
  console.log('');
  console.log('  Edit compact / standard / wide → Save to ship code');
  console.log('  Then rebuild: pnpm --filter @mitii/v8 build');
  console.log('');
  const open =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  import('node:child_process')
    .then(({ exec }) => {
      exec(`${open} ${url}`, () => {});
    })
    .catch(() => {});
});
