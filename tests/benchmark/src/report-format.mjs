import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the Mitii agent environment used for a benchmark run.
 * Prefers explicit config / env; infers context window from model name when needed.
 */
export function resolveAgentEnvironment(options = {}) {
  const repoRoot = options.repoRoot ?? defaultMitiiRoot();
  const fromEnv = {
    model: process.env.MITII_MODEL || process.env.MITII_LLM_MODEL || null,
    provider:
      process.env.MITII_PROVIDER ||
      process.env.MITII_PROVIDER_PRESET ||
      null,
    contextWindowTokens: parseTokenCount(
      process.env.MITII_CONTEXT_WINDOW ||
        process.env.MITII_CONTEXT_WINDOW_TOKENS ||
        '',
    ),
    baseUrl: process.env.MITII_BASE_URL || null,
  };

  const config = readMitiiConfig(repoRoot);
  const model =
    options.model ||
    fromEnv.model ||
    config?.model ||
    null;
  const provider =
    options.provider ||
    fromEnv.provider ||
    config?.providerPreset ||
    config?.provider ||
    null;
  const baseUrl =
    options.baseUrl || fromEnv.baseUrl || config?.baseUrl || null;

  let contextWindowTokens =
    options.contextWindowTokens ??
    fromEnv.contextWindowTokens ??
    parseTokenCount(config?.contextWindowTokens) ??
    parseTokenCount(config?.windowBudget?.contextWindowTokens) ??
    inferContextWindowFromModel(model);

  return {
    model: model || 'unknown',
    provider: provider || 'unknown',
    contextWindowTokens,
    contextWindowLabel: formatContextWindow(contextWindowTokens),
    baseUrl: baseUrl || null,
    source: config ? 'mitii-config' : fromEnv.model ? 'env' : 'default',
  };
}

export function enrichReportEnvironment(report, options = {}) {
  if (report?.environment?.model && report.environment.model !== 'unknown') {
    return {
      ...report,
      environment: {
        ...report.environment,
        contextWindowLabel:
          report.environment.contextWindowLabel ||
          formatContextWindow(report.environment.contextWindowTokens),
      },
    };
  }
  return {
    ...report,
    environment: resolveAgentEnvironment(options),
  };
}

export function fmtTokens(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const compact = (x, suffix) => {
    const rounded = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
    const text = String(rounded).replace(/\.0$/, '');
    return sign + text + suffix;
  };
  if (a >= 1e9) return compact(a / 1e9, 'B');
  if (a >= 1e6) return compact(a / 1e6, 'M');
  if (a >= 1e3) return compact(a / 1e3, 'K');
  return sign + String(Math.round(a));
}

export function fmtDuration(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const ms = Number(n);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export function shortDesc(text, limit = 96) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return 'No prompt';
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit - 1).trimEnd()}…`;
}

export function formatContextWindow(tokens) {
  if (tokens == null || !Number.isFinite(Number(tokens))) return '—';
  const n = Number(tokens);
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M tokens`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : Math.round(k)}K tokens`;
  }
  return `${Math.round(n)} tokens`;
}

/**
 * Infer context window from common model name patterns (e.g. qwen-64k, 128k, 1m).
 */
export function inferContextWindowFromModel(model) {
  if (!model) return null;
  const text = String(model).toLowerCase();
  const m = text.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)(k|m)(?:[^a-z0-9]|$)/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  if (m[2].toLowerCase() === 'm') return Math.round(value * 1_000_000);
  return Math.round(value * 1000);
}

function parseTokenCount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  const m = text.match(/^(\d+(?:\.\d+)?)\s*(k|m|b)?$/i);
  if (!m) {
    const asInt = Number(text.replace(/_/g, ''));
    return Number.isFinite(asInt) ? Math.round(asInt) : null;
  }
  const n = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'b') return Math.round(n * 1e9);
  if (unit === 'm') return Math.round(n * 1e6);
  if (unit === 'k') return Math.round(n * 1e3);
  return Math.round(n);
}

function readMitiiConfig(repoRoot) {
  const candidates = [
    join(repoRoot, '.mitii', 'config.json'),
    join(repoRoot, 'config.json'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // ignore
    }
  }
  return null;
}

function defaultMitiiRoot() {
  // tests/benchmark/src → Mitii/
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../..');
}
