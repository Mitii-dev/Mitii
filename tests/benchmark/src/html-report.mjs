import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { enrichReportEnvironment } from './report-format.mjs';
import { renderExportMarkdown } from './report-export-md.mjs';

const DETAILS_LIMIT = 400;
const STDOUT_PREVIEW = 800;

/**
 * Prepare a report payload safe/small enough to embed in HTML.
 * Drops bulky agent stdout streams; keeps grading signal intact.
 */
export function sanitizeReportForViewer(report, meta = {}) {
  const results = (report.results ?? []).map((result) => sanitizeResult(result));
  const environment = sanitizeEnvironment(report.environment);
  return {
    runId: meta.runId ?? report.runId ?? null,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    suite: report.suite,
    signal: report.signal,
    completeSelection: report.completeSelection,
    partial: report.partial,
    expectedTotal: report.expectedTotal,
    completed: report.completed,
    environment,
    gates: report.gates,
    gateResults: report.gateResults,
    overall: report.overall,
    difficulties: report.difficulties,
    byMode: report.byMode,
    byCapability: report.byCapability,
    bySuite: report.bySuite,
    byCategory: report.byCategory,
    usageTotals: report.usageTotals,
    results,
  };
}

function sanitizeEnvironment(environment) {
  if (!environment || typeof environment !== 'object') return null;
  return {
    model: environment.model ?? null,
    provider: environment.provider ?? null,
    contextWindowTokens: environment.contextWindowTokens ?? null,
    contextWindowLabel: environment.contextWindowLabel ?? null,
    baseUrl: environment.baseUrl ?? null,
  };
}

function sanitizeResult(result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return {
    id: result.id,
    familyId: result.familyId,
    variant: result.variant,
    suite: result.suite,
    category: result.category,
    difficulty: result.difficulty,
    mode: result.mode,
    capability: result.capability,
    fixture: result.fixture,
    prompt: result.prompt ?? '',
    passed: Boolean(result.passed),
    error: result.error ?? null,
    durationMs: result.durationMs ?? null,
    exitCode: result.exitCode ?? null,
    usage: result.usage ?? null,
    preconditions: (result.preconditions ?? []).map(sanitizeCheck),
    checks: (result.checks ?? []).map(sanitizeCheck),
    stdoutPreview: truncate(stdout, STDOUT_PREVIEW),
    stderrPreview: truncate(stderr, STDOUT_PREVIEW),
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
  };
}

function sanitizeCheck(check) {
  return {
    type: check.type,
    passed: Boolean(check.passed),
    details: truncate(check.details ?? '', DETAILS_LIMIT),
  };
}

function truncate(value, limit) {
  const text = String(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export function writeRunHtml(report, htmlPath, meta = {}) {
  mkdirSync(dirname(htmlPath), { recursive: true });
  const runId = meta.runId ?? inferRunId(htmlPath);
  const enriched = enrichReportEnvironment(report, { repoRoot: meta.repoRoot });
  if (!enriched.runId) enriched.runId = runId;
  const payload = sanitizeReportForViewer(enriched, { runId });
  const markdown =
    meta.markdown ??
    renderExportMarkdown(enriched, { runId, repoRoot: meta.repoRoot });
  writeFileSync(
    htmlPath,
    renderRunHtml(payload, {
      ...meta,
      runId,
      markdown,
    }),
  );
  return htmlPath;
}

export function writeRunsIndex(reportRoot) {
  const runsDir = join(reportRoot, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const runs = listRunSummaries(runsDir);
  const indexPath = join(reportRoot, 'index.html');
  writeFileSync(indexPath, renderIndexHtml(runs));
  return { indexPath, runs };
}

export function listRunSummaries(runsDir) {
  if (!existsSync(runsDir)) return [];
  const entries = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const runs = [];
  for (const runId of entries) {
    const summaryPath = join(runsDir, runId, 'summary.json');
    if (!existsSync(summaryPath)) continue;
    try {
      const report = JSON.parse(readFileSync(summaryPath, 'utf8'));
      const env = report.environment ?? {};
      runs.push({
        runId,
        suite: report.suite ?? 'unknown',
        signal: report.signal ?? 'UNKNOWN',
        startedAt: report.startedAt ?? null,
        finishedAt: report.finishedAt ?? null,
        partial: Boolean(report.partial),
        completed: report.completed ?? report.overall?.total ?? 0,
        expectedTotal: report.expectedTotal ?? report.overall?.total ?? 0,
        passed: report.overall?.passed ?? 0,
        failed: report.overall?.failed ?? 0,
        caseScore: report.overall?.caseScore ?? 0,
        familyScore: report.overall?.familyScore ?? 0,
        avgDurationMs: report.overall?.avgDurationMs ?? null,
        usageTotals: report.usageTotals ?? null,
        model: env.model ?? null,
        contextWindowLabel: env.contextWindowLabel ?? null,
        href: `runs/${runId}/summary.html`,
      });
    } catch {
      // Skip unreadable summaries.
    }
  }
  return runs;
}

export function generateViewer(reportRoot, options = {}) {
  const runsDir = join(reportRoot, 'runs');
  const runIds = options.runId
    ? [options.runId]
    : existsSync(runsDir)
      ? readdirSync(runsDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [];

  const written = [];
  for (const runId of runIds) {
    const summaryPath = join(runsDir, runId, 'summary.json');
    if (!existsSync(summaryPath)) continue;
    const report = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const enriched = enrichReportEnvironment(report, { repoRoot: options.repoRoot });
    if (!enriched.runId) enriched.runId = runId;
    writeFileSync(summaryPath, `${JSON.stringify(enriched, null, 2)}\n`);

    const markdown = renderExportMarkdown(enriched, {
      runId,
      repoRoot: options.repoRoot,
    });
    const markdownPath = join(runsDir, runId, 'summary.md');
    const briefPath = join(runsDir, runId, 'brief.md');
    writeFileSync(markdownPath, markdown);
    writeFileSync(briefPath, markdown);

    const htmlPath = join(runsDir, runId, 'summary.html');
    writeRunHtml(enriched, htmlPath, {
      runId,
      live: options.live ?? null,
      indexHref: '../../index.html',
      markdown,
      repoRoot: options.repoRoot,
    });
    written.push(htmlPath);
  }

  const { indexPath, runs } = writeRunsIndex(reportRoot);

  // Refresh elegant Markdown for top-level latest summaries (latest.json, *-latest.json).
  if (existsSync(reportRoot)) {
    for (const name of readdirSync(reportRoot)) {
      if (!name.endsWith('.json')) continue;
      if (name === 'package.json') continue;
      const jsonPath = join(reportRoot, name);
      try {
        const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
        if (!report || typeof report !== 'object' || !Array.isArray(report.results)) continue;
        const enriched = enrichReportEnvironment(report, { repoRoot: options.repoRoot });
        writeFileSync(jsonPath, `${JSON.stringify(enriched, null, 2)}\n`);
        const markdown = renderExportMarkdown(enriched, {
          runId: enriched.runId ?? name.replace(/\.json$/i, ''),
          repoRoot: options.repoRoot,
        });
        writeFileSync(jsonPath.replace(/\.json$/i, '.md'), markdown);
        if (name === 'latest.json') {
          writeFileSync(join(reportRoot, 'brief.md'), markdown);
        }
        const htmlPath = jsonPath.replace(/\.json$/i, '.html');
        writeRunHtml(enriched, htmlPath, {
          runId: enriched.runId,
          indexHref: 'index.html',
          markdown,
          repoRoot: options.repoRoot,
        });
        written.push(htmlPath);
      } catch {
        // Skip non-report JSON.
      }
    }
  }

  return { indexPath, written, runs };
}

function inferRunId(htmlPath) {
  return basename(dirname(htmlPath));
}

function fontLinks() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet" />`;
}

function renderRunHtml(payload, meta = {}) {
  const dataJson = JSON.stringify(payload).replaceAll('</', '<\\/');
  const markdown = String(meta.markdown ?? '').replaceAll('</', '<\\/');
  const liveNote =
    meta.live != null ? `Live ${meta.live.completed}/${meta.live.total}` : '';
  const indexHref = meta.indexHref ?? '../../index.html';
  const runLabel = payload.runId ?? 'run';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Mitii agent evaluation brief — ${escapeHtml(payload.suite ?? 'suite')} · ${escapeHtml(payload.signal ?? '')}" />
  <meta property="og:title" content="Mitii Benchmark · ${escapeHtml(payload.signal ?? '')} · ${escapeHtml(payload.suite ?? '')}" />
  <meta property="og:description" content="Agent coding evaluation report suitable for sharing." />
  <title>Mitii Benchmark run ${escapeHtml(runLabel)}</title>
  ${fontLinks()}
  <style>${sharedCss()}${runCss()}${printCss()}</style>
</head>
<body class="run-page">
  <div class="atmosphere" aria-hidden="true"></div>
  <div class="shell screen-only">
    <header class="topbar">
      <div class="topbar-brand">
        <a class="brand" href="${escapeHtml(indexHref)}">
          <span class="brand-mark">Mitii</span>
          <span class="brand-sub">Eval</span>
        </a>
        <span class="crumb-sep" aria-hidden="true">/</span>
        <span class="crumb">${escapeHtml(payload.suite ?? 'suite')}</span>
        <span class="signal" data-signal="${escapeHtml(payload.signal ?? '')}">${escapeHtml(payload.signal ?? '—')}</span>
        ${liveNote ? `<span class="live-chip">${escapeHtml(liveNote)}</span>` : ''}
      </div>
      <div class="topbar-meta" id="run-meta"></div>
      <div class="topbar-actions">
        <nav class="tabs" role="tablist">
          <button type="button" class="tab active" data-tab="overview">Brief</button>
          <button type="button" class="tab" data-tab="cases">Cases</button>
        </nav>
        <button type="button" class="btn btn-ghost" id="copy-link" title="Copy page link">Copy link</button>
        <button type="button" class="btn btn-ghost" id="export-md" title="Download Markdown brief">Export MD</button>
        <button type="button" class="btn btn-primary" id="export-pdf">Export PDF</button>
      </div>
    </header>

    <main class="main">
      <section class="view active" id="view-overview">
        <header class="hero" id="hero"></header>
        <div class="kpi" id="kpi"></div>
        <div class="split-2 brief-top">
          <article class="panel">
            <h2>By difficulty</h2>
            <div id="chart-difficulty" class="chart-box"></div>
          </article>
          <article class="panel" id="gates-card"></article>
        </div>
        <article class="panel brief-cases-panel">
          <div class="panel-head">
            <h2 id="brief-cases-title">Cases</h2>
            <button type="button" class="btn btn-ghost" id="brief-open-cases">Open Cases tab</button>
          </div>
          <div id="brief-cases" class="brief-cases"></div>
        </article>
      </section>

      <section class="view" id="view-cases">
        <div class="cases-shell">
          <div class="cases-side">
            <div class="filters">
              <input id="search" type="search" placeholder="Search cases…" />
              <select id="status-filter">
                <option value="all">All</option>
                <option value="fail">Failed</option>
                <option value="pass">Passed</option>
              </select>
              <select id="difficulty-filter"><option value="all">Difficulty</option></select>
              <select id="category-filter"><option value="all">Category</option></select>
              <select id="capability-filter"><option value="all">Capability</option></select>
              <select id="sort">
                <option value="fail-first">Failures first</option>
                <option value="index">Run order</option>
                <option value="duration-desc">Slowest</option>
                <option value="id">ID</option>
              </select>
              <span class="count" id="case-count"></span>
            </div>
            <div class="case-list" id="case-list"></div>
          </div>
          <aside class="case-detail" id="case-detail"></aside>
        </div>
      </section>
    </main>
  </div>

  <article class="print-brief" id="print-summary" aria-hidden="true"></article>

  <script id="run-data" type="application/json">${dataJson}</script>
  <script id="export-md-source" type="text/markdown">${markdown}</script>
  <script>${runViewerJs()}</script>
</body>
</html>
`;
}

function renderIndexHtml(runs) {
  const dataJson = JSON.stringify(runs).replaceAll('</', '<\\/');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Mitii agent benchmark run history" />
  <title>Mitii Benchmark runs</title>
  ${fontLinks()}
  <style>${sharedCss()}${indexCss()}${printCss()}</style>
</head>
<body class="index-page">
  <div class="atmosphere" aria-hidden="true"></div>
  <div class="shell">
    <header class="topbar">
      <div class="topbar-brand">
        <span class="brand">
          <span class="brand-mark">Mitii</span>
          <span class="brand-sub">Eval</span>
        </span>
        <span class="crumb-sep" aria-hidden="true">/</span>
        <span class="crumb">Benchmark runs</span>
        <span class="muted" id="index-meta"></span>
      </div>
      <div class="topbar-actions">
        <input id="index-search" type="search" placeholder="Search runs…" />
        <select id="index-signal">
          <option value="all">All signals</option>
          <option value="GO">GO</option>
          <option value="NO-GO">NO-GO</option>
          <option value="RUNNING">RUNNING</option>
          <option value="PARTIAL">PARTIAL</option>
        </select>
        <select id="index-suite"><option value="all">All suites</option></select>
        <a class="btn btn-ghost" href="cases.html">Browse cases</a>
        <button type="button" class="btn btn-primary" id="export-pdf">Export PDF</button>
      </div>
    </header>
    <main class="main index-main">
      <header class="hero hero-compact" id="index-hero">
        <p class="hero-kicker">Mitii agent evaluation</p>
        <h1 class="hero-title">Benchmark archive</h1>
        <p class="hero-lede">Ship-gate history across coding suites — ready to share or print.</p>
      </header>
      <div class="index-kpis" id="index-kpis"></div>
      <div class="panel chart-card">
        <h2>Recent family scores</h2>
        <div id="index-chart" class="chart-box tall"></div>
      </div>
      <div class="panel table-card">
        <table class="run-table" id="run-table">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Suite</th>
              <th>Passed</th>
              <th>Score</th>
              <th>Started</th>
              <th>Run</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </main>
  </div>
  <script id="runs-data" type="application/json">${dataJson}</script>
  <script>${indexViewerJs()}</script>
</body>
</html>
`;
}

export function sharedCss() {
  return `
:root {
  --ink: #0a1628;
  --ink-soft: #243044;
  --muted: #5b6b7c;
  --line: #d8dee6;
  --line-soft: #e8edf3;
  --panel: #ffffff;
  --canvas: #eef2f6;
  --accent: #0f766e;
  --accent-deep: #0a5c56;
  --accent-soft: #d8f3ef;
  --pass: #047857;
  --pass-soft: #d1fae5;
  --fail: #b91c1c;
  --fail-soft: #fee2e2;
  --warn: #b45309;
  --warn-soft: #ffedd5;
  --info: #1d4ed8;
  --info-soft: #dbeafe;
  --track: #e4e9ef;
  --shadow: 0 18px 50px rgba(10, 22, 40, 0.08);
  --radius: 18px;
  --display: "Fraunces", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --sans: "Manrope", "Avenir Next", "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", "SF Mono", ui-monospace, Menlo, monospace;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  color: var(--ink);
  font: 14.5px/1.5 var(--sans);
  background: var(--canvas);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.atmosphere {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(ellipse 80% 55% at 8% -10%, rgba(15, 118, 110, 0.18), transparent 55%),
    radial-gradient(ellipse 70% 50% at 100% 0%, rgba(29, 78, 216, 0.10), transparent 50%),
    radial-gradient(ellipse 60% 40% at 70% 100%, rgba(180, 83, 9, 0.06), transparent 45%),
    linear-gradient(180deg, #f5f7fa 0%, #e8eef4 100%);
}
.shell {
  position: relative;
  z-index: 1;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
button, input, select { font: inherit; color: inherit; }
.topbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 22px;
  background: rgba(255,255,255,0.82);
  border-bottom: 1px solid rgba(216, 222, 230, 0.9);
  backdrop-filter: blur(14px);
}
.topbar-brand, .topbar-actions { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
.topbar-meta {
  flex: 1;
  text-align: center;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.brand { display: inline-flex; align-items: baseline; gap: 8px; text-decoration: none; color: inherit; }
.brand-mark {
  font-family: var(--display);
  font-weight: 700;
  font-size: 22px;
  letter-spacing: -0.03em;
  line-height: 1;
}
.brand-sub {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}
.crumb { font-weight: 700; color: var(--ink-soft); }
.crumb-sep { color: var(--line); }
.muted, .live-chip { color: var(--muted); font-size: 12.5px; font-weight: 500; }
.live-chip {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--info-soft);
  color: var(--info);
  font-weight: 700;
}
.signal {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--track);
  font: 700 11px/1 var(--mono);
  letter-spacing: 0.06em;
}
.signal[data-signal="GO"] { color: var(--pass); background: var(--pass-soft); }
.signal[data-signal="NO-GO"] { color: var(--fail); background: var(--fail-soft); }
.signal[data-signal="RUNNING"], .signal[data-signal="PARTIAL"] { color: var(--info); background: var(--info-soft); }
.tabs {
  display: inline-flex;
  padding: 4px;
  background: var(--track);
  border-radius: 12px;
  gap: 2px;
}
.tab {
  border: 0;
  background: transparent;
  padding: 8px 14px;
  border-radius: 9px;
  font-weight: 700;
  color: var(--muted);
  cursor: pointer;
}
.tab.active {
  background: var(--panel);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(10,22,40,0.06);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 8px 14px;
  border-radius: 11px;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  white-space: nowrap;
}
.btn:hover { border-color: #b8c2ce; }
.btn-primary {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}
.btn-primary:hover { background: var(--ink-soft); border-color: var(--ink-soft); }
.btn-ghost { background: transparent; }
.main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 22px 36px;
}
.view { display: none; }
.view.active { display: block; height: 100%; }
.hero {
  position: relative;
  margin: 0 0 18px;
  padding: 20px 4px 8px;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(260px, 340px);
  gap: 28px 40px;
  align-items: start;
  max-width: none;
}
.hero-compact {
  display: block;
  padding-top: 12px;
  margin-bottom: 8px;
  max-width: 920px;
}
@media (max-width: 900px) {
  .hero { grid-template-columns: 1fr; }
}
.hero-copy { min-width: 0; }
.hero-kicker {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
}
.hero-brand {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(40px, 6vw, 64px);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 0.95;
}
.hero-title {
  margin: 10px 0 0;
  font-size: clamp(22px, 3vw, 32px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: var(--ink-soft);
}
.hero-lede {
  margin: 12px 0 0;
  max-width: 54ch;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.55;
}
.setup-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}
.setup-chip {
  display: inline-flex;
  flex-direction: column;
  gap: 3px;
  min-width: 140px;
  padding: 11px 14px;
  border-radius: 14px;
  background: rgba(255,255,255,0.78);
  border: 1px solid rgba(216,222,230,0.95);
  box-shadow: 0 8px 24px rgba(10, 22, 40, 0.04);
}
.setup-chip .k {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.setup-chip .v {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink);
  word-break: break-word;
}
.setup-chip.accent {
  background: linear-gradient(160deg, rgba(216,243,239,0.95), rgba(255,255,255,0.9));
  border-color: rgba(15, 118, 110, 0.22);
}
.hero-score-card {
  justify-self: end;
  width: 100%;
  max-width: 340px;
  padding: 22px 22px 18px;
  border-radius: var(--radius);
  background: rgba(255,255,255,0.92);
  border: 1px solid rgba(216,222,230,0.95);
  box-shadow: var(--shadow);
  text-align: right;
}
@media (max-width: 900px) {
  .hero-score-card { justify-self: stretch; max-width: none; text-align: left; }
}
.hero-score {
  font-family: var(--display);
  font-size: clamp(48px, 7vw, 64px);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 0.9;
}
.hero-score-label {
  margin-top: 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.hero-score-card .signal { margin-top: 12px; }
.hero-score-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line-soft);
  text-align: left;
}
.hero-score-grid .cell .k {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.hero-score-grid .cell .v {
  margin-top: 4px;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.panel {
  background: rgba(255,255,255,0.88);
  border: 1px solid rgba(216,222,230,0.95);
  border-radius: var(--radius);
  padding: 18px;
  box-shadow: var(--shadow);
}
.panel h2, .panel h3 {
  margin: 0 0 14px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.kpi {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
@media (max-width: 900px) { .kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) {
  .kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .topbar { flex-direction: column; align-items: stretch; }
  .topbar-meta { text-align: left; }
}
.kpi .panel { padding: 14px 16px; }
.kpi .label { color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.kpi .value { margin-top: 8px; font-size: 26px; font-weight: 800; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.kpi .hint { margin-top: 4px; color: var(--muted); font-size: 12px; }
.brief-top { margin-bottom: 14px; }
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.panel-head h2 { margin: 0; }
.brief-cases-panel { margin-bottom: 8px; }
.brief-cases { max-height: 520px; overflow: auto; margin: 0 -6px; }
.brief-cases .case-table th { top: 0; }
.chart-box { min-height: 160px; }
.chart-box.tall { min-height: 220px; }
.split-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 900px) { .split-2 { grid-template-columns: 1fr; } }
.bar-row {
  display: grid;
  grid-template-columns: minmax(72px, 110px) 1fr 54px;
  gap: 10px;
  align-items: center;
  margin: 9px 0;
}
.bar-row .name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar-track { height: 9px; background: var(--track); border-radius: 999px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 999px; background: var(--accent); }
.bar-fill.pass { background: var(--pass); }
.bar-fill.warn { background: var(--warn); }
.bar-fill.fail { background: var(--fail); }
.bar-row .val { text-align: right; font: 600 12px/1 var(--mono); color: var(--muted); }
.donut-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  min-height: 180px;
}
.donut-wrap svg { display: block; }
.donut-label { text-align: center; }
.donut-label .big {
  font-family: var(--display);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.donut-label .small { color: var(--muted); font-size: 12px; font-weight: 600; }
.mini-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.mini-table th, .mini-table td {
  text-align: left;
  padding: 10px 4px;
  border-bottom: 1px solid var(--line-soft);
}
.mini-table th {
  color: var(--muted);
  font-weight: 800;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.mini-table .num { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--mono); font-size: 12px; }
.pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font: 700 10px/1 var(--mono);
  background: var(--track);
}
.pill.pass { color: var(--pass); background: var(--pass-soft); }
.pill.fail { color: var(--fail); background: var(--fail-soft); }
.pill.na { color: var(--muted); }
.fail-list { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow: auto; }
.fail-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line-soft);
  font-size: 13px;
}
.fail-list button {
  border: 0;
  background: none;
  padding: 0;
  color: var(--accent-deep);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.fail-list .meta { color: var(--muted); white-space: nowrap; font-size: 12px; }
.empty { padding: 28px 12px; color: var(--muted); text-align: center; font-weight: 600; }
.print-brief { display: none; }
`;
}

function runCss() {
  return `
.cases-shell {
  display: grid;
  grid-template-columns: minmax(420px, 1.15fr) minmax(0, 0.95fr);
  gap: 14px;
  height: calc(100vh - 96px);
  min-height: 0;
}
@media (max-width: 960px) {
  .cases-shell { grid-template-columns: 1fr; height: auto; }
}
.cases-side, .case-detail {
  min-height: 0;
  background: rgba(255,255,255,0.9);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--line-soft);
  background: rgba(248,250,252,0.8);
}
.filters input, .filters select, .topbar-actions input, .topbar-actions select {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 10px;
  padding: 8px 10px;
  min-width: 0;
}
.filters input[type="search"] { flex: 1 1 140px; }
.filters .count { margin-left: auto; color: var(--muted); font-size: 12px; font-weight: 700; }
.case-list { flex: 1; overflow: auto; }
.case-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.case-table th, .case-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: top;
  text-align: left;
}
.case-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8fafc;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.case-table th.num, .case-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--mono);
  font-size: 12px;
  white-space: nowrap;
}
.case-table th.col-status, .case-table td.col-status { width: 58px; }
.case-table th.col-time, .case-table td.col-time { width: 64px; }
.case-table th.col-in, .case-table td.col-in,
.case-table th.col-out, .case-table td.col-out { width: 64px; }
.case-table th.col-cat, .case-table td.col-cat {
  width: 110px;
  font-size: 12px;
  color: var(--ink-soft);
  font-weight: 600;
}
.case-table tbody tr {
  cursor: pointer;
}
.case-table tbody tr:hover td { background: #f8fafc; }
.case-table tbody tr.active td { background: var(--accent-soft); }
.case-table .id {
  font: 600 11.5px/1.35 var(--mono);
  word-break: break-all;
}
.case-table .desc {
  margin-top: 3px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.case-table .meta {
  margin-top: 4px;
  color: #8a97a6;
  font-size: 11px;
  font-weight: 600;
}
.status { font: 700 11px/1.3 var(--mono); }
.status.pass { color: var(--pass); }
.status.fail { color: var(--fail); }
.case-detail { padding: 18px 20px; overflow: auto; }
.case-detail h3 { margin: 6px 0 0; font: 700 15px/1.35 var(--mono); word-break: break-all; }
.case-detail h4 {
  margin: 18px 0 8px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.kv { display: grid; grid-template-columns: 108px 1fr; gap: 6px 12px; margin: 14px 0; font-size: 13px; }
.kv dt { color: var(--muted); font-weight: 600; }
.prompt, .block {
  white-space: pre-wrap;
  word-break: break-word;
  background: #f7f9fb;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  padding: 12px 14px;
  font: 12px/1.5 var(--mono);
}
.check-list { list-style: none; margin: 0; padding: 0; }
.check-list li {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 8px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line-soft);
}
.check-list .type { font-family: var(--mono); font-weight: 600; font-size: 12px; }
.check-list .details { color: var(--muted); margin-top: 2px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
`;
}

function indexCss() {
  return `
.index-main { display: flex; flex-direction: column; gap: 14px; }
.index-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .index-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.table-card { padding: 0; overflow: auto; }
.run-table { width: 100%; border-collapse: collapse; }
.run-table th, .run-table td {
  text-align: left;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
}
.run-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.run-table a {
  color: var(--accent-deep);
  text-decoration: none;
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
}
.run-table a:hover { text-decoration: underline; }
.run-table tr:hover td { background: #f8fafc; }
.score-cell { display: flex; align-items: center; gap: 10px; min-width: 140px; }
.score-cell .track { flex: 1; height: 8px; background: var(--track); border-radius: 999px; overflow: hidden; }
.score-cell .fill { height: 100%; background: var(--accent); }
`;
}

function printCss() {
  return `
@media print {
  @page { margin: 14mm 14mm 16mm; size: auto; }
  .atmosphere, .screen-only .topbar-actions, .btn, .tabs, .filters, .cases-shell, .view { display: none !important; }
  body {
    background: #fff !important;
    height: auto !important;
    color: #0a1628;
  }
  .atmosphere { display: none !important; }
  .shell, .main { height: auto !important; overflow: visible !important; }
  .screen-only { display: none !important; }
  .print-brief {
    display: block !important;
    padding: 0;
    color: #0a1628;
    font-family: "Manrope", "Avenir Next", "Segoe UI", sans-serif;
  }
  .print-brief .cover {
    min-height: 88vh;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-after: always;
    padding-bottom: 8mm;
  }
  .print-brief .brand-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 2px solid #0a1628;
    padding-bottom: 10px;
  }
  .print-brief .brand-name {
    font-family: "Fraunces", Georgia, serif;
    font-size: 34px;
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .print-brief .brand-tag {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #0f766e;
  }
  .print-brief .cover-body { padding: 36px 0 24px; }
  .print-brief .cover-kicker {
    margin: 0 0 12px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #0f766e;
  }
  .print-brief .cover-title {
    margin: 0;
    font-family: "Fraunces", Georgia, serif;
    font-size: 42px;
    line-height: 1.05;
    letter-spacing: -0.03em;
  }
  .print-brief .cover-lede {
    margin: 14px 0 0;
    max-width: 46ch;
    font-size: 14px;
    line-height: 1.55;
    color: #445466;
  }
  .print-brief .cover-score {
    margin-top: 28px;
    display: flex;
    align-items: flex-end;
    gap: 18px;
  }
  .print-brief .cover-score .num {
    font-family: "Fraunces", Georgia, serif;
    font-size: 84px;
    font-weight: 700;
    letter-spacing: -0.04em;
    line-height: 0.9;
  }
  .print-brief .cover-score .side { padding-bottom: 8px; }
  .print-brief .cover-score .side .signal {
    display: inline-block;
    padding: 6px 12px;
    border-radius: 999px;
    font: 700 12px/1 "IBM Plex Mono", Menlo, monospace;
    letter-spacing: 0.06em;
  }
  .print-brief .cover-score .side .signal.go { background: #d1fae5; color: #047857; }
  .print-brief .cover-score .side .signal.nogo { background: #fee2e2; color: #b91c1c; }
  .print-brief .cover-score .side .signal.other { background: #dbeafe; color: #1d4ed8; }
  .print-brief .cover-meta {
    margin-top: 8px;
    font-size: 12px;
    color: #5b6b7c;
  }
  .print-brief .setup-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 18px;
    margin: 18px 0 6px;
    padding: 14px 16px;
    border: 1px solid #d8dee6;
    border-radius: 12px;
    background: #f7f9fb;
  }
  .print-brief .setup-item .k {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #5b6b7c;
  }
  .print-brief .setup-item .v {
    margin-top: 3px;
    font-family: "IBM Plex Mono", Menlo, monospace;
    font-size: 12px;
    font-weight: 600;
    color: #0a1628;
  }
  .print-brief .gate-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 34px;
  }
  .print-brief .gate {
    border: 1px solid #d8dee6;
    border-radius: 12px;
    padding: 12px 14px;
  }
  .print-brief .gate .label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #5b6b7c;
  }
  .print-brief .gate .value {
    margin-top: 6px;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .print-brief .gate .sub { margin-top: 4px; font-size: 11px; color: #5b6b7c; }
  .print-brief .footer-note {
    font-size: 11px;
    color: #5b6b7c;
    border-top: 1px solid #e8edf3;
    padding-top: 10px;
  }
  .print-brief h2 {
    margin: 0 0 10px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #5b6b7c;
  }
  .print-brief .section { margin-top: 22px; page-break-inside: avoid; }
  .print-brief table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  .print-brief th, .print-brief td {
    border-bottom: 1px solid #e8edf3;
    padding: 7px 4px;
    text-align: left;
    vertical-align: top;
  }
  .print-brief th {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #5b6b7c;
  }
  .print-brief td.mono { font-family: "IBM Plex Mono", Menlo, monospace; font-size: 10px; }
  .print-brief .pass { color: #047857; font-weight: 700; }
  .print-brief .fail { color: #b91c1c; font-weight: 700; }
  .index-page .shell { display: block !important; height: auto !important; }
  .index-page .topbar-actions { display: none !important; }
  .index-page .main { overflow: visible !important; padding: 0 !important; }
  .index-page .hero { padding: 0 0 12px !important; }
  .index-page .panel { box-shadow: none !important; break-inside: avoid; }
}
`;
}

function runViewerJs() {
  return `
const data = JSON.parse(document.getElementById('run-data').textContent);
const results = Array.isArray(data.results) ? data.results.map((r, i) => ({ ...r, _index: i })) : [];

const els = {
  meta: document.getElementById('run-meta'),
  hero: document.getElementById('hero'),
  kpi: document.getElementById('kpi'),
  difficulty: document.getElementById('chart-difficulty'),
  gates: document.getElementById('gates-card'),
  briefCases: document.getElementById('brief-cases'),
  briefCasesTitle: document.getElementById('brief-cases-title'),
  list: document.getElementById('case-list'),
  detail: document.getElementById('case-detail'),
  count: document.getElementById('case-count'),
  search: document.getElementById('search'),
  status: document.getElementById('status-filter'),
  difficultyFilter: document.getElementById('difficulty-filter'),
  categoryFilter: document.getElementById('category-filter'),
  capabilityFilter: document.getElementById('capability-filter'),
  sort: document.getElementById('sort'),
  print: document.getElementById('print-summary'),
};

function pct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return (n * 100).toFixed(1) + '%';
}
function pctNum(n) { return n == null || Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, n * 100)); }
function ms(n) {
  if (n == null) return '—';
  if (n < 1000) return Math.round(n) + 'ms';
  if (n < 60000) return (n / 1000).toFixed(1) + 's';
  return (n / 60000).toFixed(1) + 'm';
}
function fmtTokens(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const compact = (x, suffix) => {
    const rounded = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
    const text = String(rounded).replace(/\\.0$/, '');
    return sign + text + suffix;
  };
  if (a >= 1e9) return compact(a / 1e9, 'B');
  if (a >= 1e6) return compact(a / 1e6, 'M');
  if (a >= 1e3) return compact(a / 1e3, 'K');
  return sign + String(Math.round(a));
}
function shortDesc(text, limit) {
  const raw = String(text || '').replace(/\\s+/g, ' ').trim();
  if (!raw) return 'No prompt';
  if (raw.length <= limit) return raw;
  return raw.slice(0, limit - 1).trimEnd() + '…';
}
function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}
function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function unique(key) {
  return [...new Set(results.map((r) => r[key]).filter(Boolean))].sort();
}
function fillSelect(select, values, label) {
  select.options[0].textContent = label;
  for (const value of values) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  }
}
function scoreClass(score) {
  if (score >= 0.9) return 'pass';
  if (score >= 0.7) return 'warn';
  return 'fail';
}
function gatePill(value) {
  if (value === true) return '<span class="pill pass">PASS</span>';
  if (value === false) return '<span class="pill fail">FAIL</span>';
  return '<span class="pill na">N/A</span>';
}
function signalClass(signal) {
  if (signal === 'GO') return 'go';
  if (signal === 'NO-GO') return 'nogo';
  return 'other';
}
function barRows(entries) {
  if (!entries.length) return '<div class="empty">No data</div>';
  return entries.map(([name, score, right]) => {
    const width = pctNum(score);
    return '<div class="bar-row"><div class="name" title="' + escapeText(name) + '">' + escapeText(name) +
      '</div><div class="bar-track"><div class="bar-fill ' + scoreClass(score) + '" style="width:' + width + '%"></div></div>' +
      '<div class="val">' + escapeText(right ?? pct(score)) + '</div></div>';
  }).join('');
}
function caseTableHtml(rows, options) {
  const opts = options || {};
  const selected = opts.selectedId || null;
  if (!rows.length) return '<div class="empty">No cases.</div>';
  return '<table class="case-table"><thead><tr>' +
    '<th class="col-status">Status</th>' +
    '<th>Test case</th>' +
    '<th class="col-cat">Category</th>' +
    '<th class="num col-time">Time</th>' +
    '<th class="num col-in">In</th>' +
    '<th class="num col-out">Out</th>' +
  '</tr></thead><tbody>' +
  rows.map((r) => {
    const u = r.usage ?? {};
    return '<tr class="' + (r.id === selected ? 'active' : '') + '" data-id="' + encodeURIComponent(r.id) + '">' +
      '<td class="col-status"><span class="status ' + (r.passed ? 'pass' : 'fail') + '">' + (r.passed ? 'PASS' : 'FAIL') + '</span></td>' +
      '<td><div class="id">' + escapeText(r.id) + '</div>' +
      '<div class="desc">' + escapeText(shortDesc(r.prompt, 96)) + '</div>' +
      '<div class="meta">' + escapeText([r.difficulty, r.capability].filter(Boolean).join(' · ')) + '</div></td>' +
      '<td class="col-cat">' + escapeText(r.category || '—') + '</td>' +
      '<td class="num col-time">' + ms(r.durationMs) + '</td>' +
      '<td class="num col-in">' + fmtTokens(u.inputTokens) + '</td>' +
      '<td class="num col-out">' + fmtTokens(u.outputTokens) + '</td>' +
    '</tr>';
  }).join('') +
  '</tbody></table>';
}

fillSelect(els.difficultyFilter, unique('difficulty'), 'Difficulty');
fillSelect(els.categoryFilter, unique('category'), 'Category');
fillSelect(els.capabilityFilter, unique('capability'), 'Capability');

const overall = data.overall ?? {};
const usage = data.usageTotals ?? {};
const difficulties = data.difficulties ?? {};
const env = data.environment ?? {};
const failed = results.filter((r) => !r.passed);
const briefRows = results.slice().sort((a, b) => Number(a.passed) - Number(b.passed) || a._index - b._index);

els.meta.textContent = [
  env.model ? 'Model ' + env.model : null,
  env.contextWindowLabel ? 'Context ' + env.contextWindowLabel : null,
  fmtTime(data.startedAt) + ' → ' + fmtTime(data.finishedAt),
  (data.completed ?? results.length) + ' / ' + (data.expectedTotal ?? results.length) + ' cases',
].filter(Boolean).join('  ·  ');

function setupChipsHtml() {
  const chips = [
    ['Model', env.model || 'unknown', true],
    ['Context window', env.contextWindowLabel || '—', true],
    ['Provider', env.provider || null, false],
  ].filter((row) => row[1]);
  if (!chips.length) return '';
  return '<div class="setup-chips">' + chips.map(([k, v, accent]) =>
    '<div class="setup-chip' + (accent ? ' accent' : '') + '"><span class="k">' + escapeText(k) +
    '</span><span class="v">' + escapeText(v) + '</span></div>'
  ).join('') + '</div>';
}

els.hero.innerHTML =
  '<div class="hero-copy">' +
    '<p class="hero-kicker">Agent evaluation brief</p>' +
    '<p class="hero-brand">Mitii</p>' +
    '<h1 class="hero-title">' + escapeText((data.suite || 'suite') + ' · ' + (data.signal || '—')) + '</h1>' +
    '<p class="hero-lede">Family-weighted coding agent score across difficulty gates. Export PDF or Markdown for LinkedIn, blogs, or release notes.</p>' +
    setupChipsHtml() +
  '</div>' +
  '<aside class="hero-score-card">' +
    '<div class="hero-score">' + pct(overall.familyScore) + '</div>' +
    '<div class="hero-score-label">Family score</div>' +
    '<div class="signal" data-signal="' + escapeText(data.signal || '') + '">' + escapeText(data.signal || '—') + '</div>' +
    '<div class="hero-score-grid">' +
      '<div class="cell"><div class="k">Passed</div><div class="v">' + (overall.passed ?? 0) + '/' + (overall.total ?? 0) + '</div></div>' +
      '<div class="cell"><div class="k">Case score</div><div class="v">' + pct(overall.caseScore) + '</div></div>' +
      '<div class="cell"><div class="k">Avg duration</div><div class="v">' + ms(overall.avgDurationMs) + '</div></div>' +
      '<div class="cell"><div class="k">Failures</div><div class="v">' + (overall.failed ?? failed.length) + '</div></div>' +
    '</div>' +
  '</aside>';

els.kpi.innerHTML = [
  ['Passed', (overall.passed ?? 0) + '/' + (overall.total ?? 0), (overall.failed ?? 0) + ' failed'],
  ['Avg duration', ms(overall.avgDurationMs), ''],
  ['Input tokens', fmtTokens(usage.inputTokens), ''],
  ['Output tokens', fmtTokens(usage.outputTokens), ''],
].map(([label, value, hint]) =>
  '<div class="panel"><div class="label">' + label + '</div><div class="value">' + value + '</div>' +
  (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'
).join('');

els.difficulty.innerHTML = barRows(
  ['easy', 'medium', 'hard']
    .filter((d) => (difficulties[d]?.total ?? 0) > 0)
    .map((d) => [d, difficulties[d].familyScore ?? 0, pct(difficulties[d].familyScore)])
);

els.gates.innerHTML = '<h2>Difficulty gates</h2><table class="mini-table"><thead><tr>' +
  '<th>Difficulty</th><th class="num">Passed</th><th class="num">Score</th><th>Gate</th></tr></thead><tbody>' +
  ['easy', 'medium', 'hard'].map((d) => {
    const item = difficulties[d] ?? { passed: 0, total: 0, familyScore: 0 };
    if (!item.total) return '';
    return '<tr><td>' + d + '</td><td class="num">' + item.passed + '/' + item.total +
      '</td><td class="num">' + pct(item.familyScore) + '</td><td>' + gatePill((data.gateResults ?? {})[d]) + '</td></tr>';
  }).join('') + '</tbody></table>';

els.briefCasesTitle.textContent = failed.length
  ? 'Cases · ' + failed.length + ' failed'
  : 'Cases';
els.briefCases.innerHTML = caseTableHtml(briefRows);

let selectedId = null;

function filtered() {
  const q = els.search.value.trim().toLowerCase();
  let rows = results.filter((r) => {
    if (els.status.value === 'pass' && !r.passed) return false;
    if (els.status.value === 'fail' && r.passed) return false;
    if (els.difficultyFilter.value !== 'all' && r.difficulty !== els.difficultyFilter.value) return false;
    if (els.categoryFilter.value !== 'all' && r.category !== els.categoryFilter.value) return false;
    if (els.capabilityFilter.value !== 'all' && r.capability !== els.capabilityFilter.value) return false;
    if (!q) return true;
    return [r.id, r.prompt, r.category, r.capability, r.fixture, r.familyId, r.error].join(' ').toLowerCase().includes(q);
  });
  const sort = els.sort.value;
  rows = rows.slice().sort((a, b) => {
    if (sort === 'fail-first') return Number(a.passed) - Number(b.passed) || a._index - b._index;
    if (sort === 'duration-desc') return (b.durationMs ?? 0) - (a.durationMs ?? 0);
    if (sort === 'id') return String(a.id).localeCompare(String(b.id));
    return a._index - b._index;
  });
  return rows;
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
}

function renderList() {
  const rows = filtered();
  els.count.textContent = rows.length + ' / ' + results.length;
  els.list.innerHTML = caseTableHtml(rows, { selectedId });
}

function kv(k, v) {
  return '<dt>' + k + '</dt><dd>' + escapeText(v == null || v === '' ? '—' : String(v)) + '</dd>';
}

function renderDetail(id) {
  const r = results.find((x) => x.id === id);
  if (!r) {
    els.detail.innerHTML = '<p class="muted">Select a case.</p>';
    return;
  }
  selectedId = id;
  const usage = r.usage ?? {};
  const checks = (r.checks ?? []).map((c) =>
    '<li><div class="status ' + (c.passed ? 'pass' : 'fail') + '">' + (c.passed ? 'PASS' : 'FAIL') +
    '</div><div><div class="type">' + escapeText(c.type) + '</div>' +
    (c.details ? '<div class="details">' + escapeText(c.details) + '</div>' : '') + '</div></li>'
  ).join('');
  const pre = (r.preconditions ?? []).map((c) =>
    '<li><div class="status ' + (c.passed ? 'pass' : 'fail') + '">' + (c.passed ? 'PASS' : 'FAIL') +
    '</div><div><div class="type">' + escapeText(c.type) + '</div></div></li>'
  ).join('');

  els.detail.innerHTML =
    '<div class="status ' + (r.passed ? 'pass' : 'fail') + '">' + (r.passed ? 'PASS' : 'FAIL') + '</div>' +
    '<h3>' + escapeText(r.id) + '</h3>' +
    '<dl class="kv">' +
    kv('Difficulty', r.difficulty) + kv('Category', r.category) + kv('Capability', r.capability) +
    kv('Fixture', r.fixture) + kv('Mode', r.mode) + kv('Duration', ms(r.durationMs)) +
    kv('Input tokens', fmtTokens(usage.inputTokens)) +
    kv('Output tokens', fmtTokens(usage.outputTokens)) +
    kv('Calls', [usage.modelCalls != null ? usage.modelCalls + ' model' : null, usage.toolCalls != null ? usage.toolCalls + ' tool' : null].filter(Boolean).join(' · ') || '—') +
    '</dl>' +
    (r.error ? '<h4>Error</h4><div class="block">' + escapeText(r.error) + '</div>' : '') +
    '<h4>Prompt</h4><div class="prompt">' + escapeText(r.prompt || '(empty)') + '</div>' +
    (pre ? '<h4>Preconditions</h4><ul class="check-list">' + pre + '</ul>' : '') +
    '<h4>Checks</h4><ul class="check-list">' + (checks || '<li class="muted">No checks</li>') + '</ul>';
  renderList();
  els.briefCases.innerHTML = caseTableHtml(briefRows, { selectedId });
}

function buildPrintSummary() {
  const caseRows = briefRows.map((r) => {
    const u = r.usage ?? {};
    return '<tr><td class="' + (r.passed ? 'pass' : 'fail') + '">' + (r.passed ? 'PASS' : 'FAIL') +
      '</td><td class="mono">' + escapeText(r.id) + '</td><td>' + escapeText(shortDesc(r.prompt, 72)) +
      '</td><td>' + escapeText(r.category || '—') +
      '</td><td>' + ms(r.durationMs) + '</td><td>' + fmtTokens(u.inputTokens) +
      '</td><td>' + fmtTokens(u.outputTokens) + '</td></tr>';
  }).join('');
  const failRows = failed.map((r) => {
    const u = r.usage ?? {};
    return '<tr><td class="mono">' + escapeText(r.id) + '</td><td>' + escapeText(shortDesc(r.prompt, 72)) +
      '</td><td>' + escapeText(r.category || '—') +
      '</td><td>' + ms(r.durationMs) + '</td><td>' + fmtTokens(u.inputTokens) +
      '</td><td>' + fmtTokens(u.outputTokens) + '</td></tr>';
  }).join('');
  const gateCards = ['easy', 'medium', 'hard'].map((d) => {
    const item = difficulties[d];
    if (!item || !item.total) return '';
    const gate = (data.gateResults ?? {})[d];
    const gateLabel = gate === true ? 'PASS' : gate === false ? 'FAIL' : '—';
    return '<div class="gate"><div class="label">' + d + ' gate</div><div class="value">' +
      pct(item.familyScore) + '</div><div class="sub">' + item.passed + '/' + item.total +
      ' · ' + gateLabel + '</div></div>';
  }).join('');

  els.print.innerHTML =
    '<section class="cover">' +
      '<div class="brand-line"><div class="brand-name">Mitii</div><div class="brand-tag">Agent Eval</div></div>' +
      '<div class="cover-body">' +
        '<p class="cover-kicker">Evaluation brief</p>' +
        '<h1 class="cover-title">' + escapeText(data.suite || 'Benchmark') + '</h1>' +
        '<p class="cover-lede">Coding-agent ship gate across easy / medium / hard suites. Family-weighted score is the headline metric.</p>' +
        '<div class="cover-score">' +
          '<div class="num">' + pct(overall.familyScore) + '</div>' +
          '<div class="side">' +
            '<span class="signal ' + signalClass(data.signal) + '">' + escapeText(data.signal || '—') + '</span>' +
            '<div class="cover-meta">' + escapeText(data.runId || '') + '<br/>' +
            escapeText(fmtTime(data.startedAt) + ' → ' + fmtTime(data.finishedAt)) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="setup-grid">' +
          '<div class="setup-item"><div class="k">Model</div><div class="v">' + escapeText(env.model || 'unknown') + '</div></div>' +
          '<div class="setup-item"><div class="k">Context window</div><div class="v">' + escapeText(env.contextWindowLabel || '—') + '</div></div>' +
          '<div class="setup-item"><div class="k">Provider</div><div class="v">' + escapeText(env.provider || '—') + '</div></div>' +
          '<div class="setup-item"><div class="k">Tokens</div><div class="v">in ' + fmtTokens(usage.inputTokens) + ' · out ' + fmtTokens(usage.outputTokens) + '</div></div>' +
        '</div>' +
        '<div class="gate-row">' + gateCards + '</div>' +
      '</div>' +
      '<div class="footer-note">Mitii benchmark · ' +
        escapeText(env.model || 'unknown') + ' · ' + escapeText(env.contextWindowLabel || 'context n/a') +
        ' · ' + (overall.passed ?? 0) + '/' + (overall.total ?? 0) + ' cases · family ' + pct(overall.familyScore) +
      '</div>' +
    '</section>' +
    '<section class="section"><h2>Cases' + (failed.length ? ' · ' + failed.length + ' failed' : '') +
    '</h2><table><thead><tr><th>Status</th><th>ID</th><th>What it tests</th><th>Category</th><th>Time</th><th>In</th><th>Out</th></tr></thead><tbody>' +
    caseRows + '</tbody></table></section>' +
    (failed.length
      ? '<section class="section"><h2>Failed cases</h2><table><thead><tr><th>ID</th><th>What it tests</th><th>Category</th><th>Time</th><th>In</th><th>Out</th></tr></thead><tbody>' +
        failRows + '</tbody></table></section>'
      : '');
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
});
function openCaseFromTable(event) {
  const row = event.target.closest('tr[data-id]');
  if (!row) return;
  showTab('cases');
  renderDetail(decodeURIComponent(row.dataset.id));
}
els.list.addEventListener('click', openCaseFromTable);
els.briefCases.addEventListener('click', openCaseFromTable);
document.getElementById('brief-open-cases').addEventListener('click', () => showTab('cases'));
for (const el of [els.search, els.status, els.difficultyFilter, els.categoryFilter, els.capabilityFilter, els.sort]) {
  el.addEventListener('input', renderList);
  el.addEventListener('change', renderList);
}
document.getElementById('export-pdf').addEventListener('click', () => {
  buildPrintSummary();
  window.print();
});
document.getElementById('export-md').addEventListener('click', () => {
  const source = document.getElementById('export-md-source');
  const text = source ? source.textContent : '';
  if (!text) return;
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (data.runId || 'mitii-brief') + '-brief.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const btn = document.getElementById('export-md');
  const prev = btn.textContent;
  btn.textContent = 'Saved';
  setTimeout(() => { btn.textContent = prev; }, 1200);
});
document.getElementById('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    const btn = document.getElementById('copy-link');
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = prev; }, 1200);
  } catch {
    // ignore
  }
});

els.sort.value = failed.length ? 'fail-first' : 'index';
renderList();
if (failed[0]) renderDetail(failed[0].id);
else if (results[0]) renderDetail(results[0].id);
else els.detail.innerHTML = '<p class="muted">No cases in this run.</p>';
buildPrintSummary();
`;
}

function indexViewerJs() {
  return `
const runs = JSON.parse(document.getElementById('runs-data').textContent);
const meta = document.getElementById('index-meta');
const search = document.getElementById('index-search');
const signal = document.getElementById('index-signal');
const suite = document.getElementById('index-suite');
const kpis = document.getElementById('index-kpis');
const chart = document.getElementById('index-chart');
const tbody = document.querySelector('#run-table tbody');

meta.textContent = runs.length + ' total';
for (const name of [...new Set(runs.map((r) => r.suite).filter(Boolean))].sort()) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
  suite.appendChild(opt);
}

function pct(n) { return n == null ? '—' : (n * 100).toFixed(1) + '%'; }
function pctNum(n) { return n == null ? 0 : Math.max(0, Math.min(100, n * 100)); }
function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}
function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function scoreClass(score) {
  if (score >= 0.9) return 'pass';
  if (score >= 0.7) return 'warn';
  return 'fail';
}

function filtered() {
  const q = search.value.trim().toLowerCase();
  return runs.filter((r) => {
    if (signal.value !== 'all' && r.signal !== signal.value) return false;
    if (suite.value !== 'all' && r.suite !== suite.value) return false;
    if (!q) return true;
    return (r.runId + ' ' + r.suite).toLowerCase().includes(q);
  });
}

function render() {
  const rows = filtered();
  const go = rows.filter((r) => r.signal === 'GO').length;
  const failedCases = rows.reduce((sum, r) => sum + (r.failed || 0), 0);
  const avg = rows.length ? rows.reduce((sum, r) => sum + (r.familyScore || 0), 0) / rows.length : 0;
  kpis.innerHTML = [
    ['Runs shown', String(rows.length), ''],
    ['GO', String(go), rows.length ? Math.round((go / rows.length) * 100) + '% of shown' : ''],
    ['Failed cases', String(failedCases), 'across shown runs'],
    ['Avg family score', pct(avg), ''],
  ].map(([label, value, hint]) =>
    '<div class="panel"><div class="label">' + label + '</div><div class="value">' + value + '</div>' +
    (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'
  ).join('');

  const chartRows = rows.slice(0, 12).map((r) => {
    const label = (r.suite || '') + ' · ' + String(r.runId || '').slice(0, 19);
    return '<div class="bar-row"><div class="name" title="' + escapeText(r.runId || '') + '">' + escapeText(label) +
      '</div><div class="bar-track"><div class="bar-fill ' + scoreClass(r.familyScore || 0) +
      '" style="width:' + pctNum(r.familyScore) + '%"></div></div><div class="val">' + pct(r.familyScore) + '</div></div>';
  }).join('');
  chart.innerHTML = chartRows || '<div class="empty">No runs match.</div>';

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No runs match.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) =>
    '<tr>' +
    '<td><span class="signal" data-signal="' + escapeText(r.signal) + '">' + escapeText(r.signal) + '</span></td>' +
    '<td>' + escapeText(r.suite) + '</td>' +
    '<td>' + r.passed + '/' + (r.expectedTotal || r.completed || 0) +
      (r.failed ? ' <span class="pill fail">' + r.failed + '</span>' : '') + '</td>' +
    '<td><div class="score-cell"><div class="track"><div class="fill" style="width:' + pctNum(r.familyScore) +
      '%"></div></div><span>' + pct(r.familyScore) + '</span></div></td>' +
    '<td>' + fmtTime(r.startedAt) + '</td>' +
    '<td><a href="' + escapeText(r.href) + '">' + escapeText(r.runId) + '</a></td>' +
    '</tr>'
  ).join('');
}

for (const el of [search, signal, suite]) {
  el.addEventListener('input', render);
  el.addEventListener('change', render);
}
document.getElementById('export-pdf').addEventListener('click', () => window.print());
render();
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
