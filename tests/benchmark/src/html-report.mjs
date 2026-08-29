import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const DETAILS_LIMIT = 400;
const STDOUT_PREVIEW = 800;

/**
 * Prepare a report payload safe/small enough to embed in HTML.
 * Drops bulky agent stdout streams; keeps grading signal intact.
 */
export function sanitizeReportForViewer(report, meta = {}) {
  const results = (report.results ?? []).map((result) => sanitizeResult(result));
  return {
    runId: meta.runId ?? null,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    suite: report.suite,
    signal: report.signal,
    completeSelection: report.completeSelection,
    partial: report.partial,
    expectedTotal: report.expectedTotal,
    completed: report.completed,
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
  const payload = sanitizeReportForViewer(report, { runId });
  writeFileSync(htmlPath, renderRunHtml(payload, meta));
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
    const htmlPath = join(runsDir, runId, 'summary.html');
    writeRunHtml(report, htmlPath, {
      runId,
      live: options.live ?? null,
      indexHref: '../../index.html',
    });
    written.push(htmlPath);
  }

  const { indexPath, runs } = writeRunsIndex(reportRoot);
  return { indexPath, written, runs };
}

function inferRunId(htmlPath) {
  return basename(dirname(htmlPath));
}

function renderRunHtml(payload, meta = {}) {
  const dataJson = JSON.stringify(payload).replaceAll('</', '<\\/');
  const liveNote =
    meta.live != null ? `Live ${meta.live.completed}/${meta.live.total}` : '';
  const indexHref = meta.indexHref ?? '../../index.html';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Benchmark run ${escapeHtml(payload.runId ?? '')}</title>
  <style>${sharedCss()}${runCss()}</style>
</head>
<body class="run-page">
  <div class="shell">
    <header class="bar">
      <div class="bar-left">
        <a class="link" href="${escapeHtml(indexHref)}">All runs</a>
        <span class="sep">/</span>
        <strong class="suite">${escapeHtml(payload.suite ?? 'suite')}</strong>
        <span class="signal" data-signal="${escapeHtml(payload.signal ?? '')}">${escapeHtml(payload.signal ?? '—')}</span>
        ${liveNote ? `<span class="live">${escapeHtml(liveNote)}</span>` : ''}
      </div>
      <div class="bar-center" id="run-meta"></div>
      <div class="bar-right">
        <nav class="tabs" role="tablist">
          <button type="button" class="tab active" data-tab="overview">Overview</button>
          <button type="button" class="tab" data-tab="cases">Cases</button>
        </nav>
        <button type="button" class="btn" id="export-pdf">Export PDF</button>
      </div>
    </header>

    <main class="main">
      <section class="view active" id="view-overview">
        <div class="kpi" id="kpi"></div>
        <div class="chart-grid">
          <article class="card">
            <h2>Result</h2>
            <div id="chart-result" class="chart-box"></div>
          </article>
          <article class="card">
            <h2>Difficulty score</h2>
            <div id="chart-difficulty" class="chart-box"></div>
          </article>
          <article class="card wide">
            <h2>Category score</h2>
            <div id="chart-category" class="chart-box"></div>
          </article>
        </div>
        <div class="split-2">
          <article class="card" id="gates-card"></article>
          <article class="card" id="failures-card"></article>
        </div>
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

  <div class="print-only" id="print-summary"></div>

  <script id="run-data" type="application/json">${dataJson}</script>
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
  <title>Benchmark runs</title>
  <style>${sharedCss()}${indexCss()}</style>
</head>
<body class="index-page">
  <div class="shell">
    <header class="bar">
      <div class="bar-left">
        <strong class="suite">Benchmark runs</strong>
        <span class="muted" id="index-meta"></span>
      </div>
      <div class="bar-right">
        <input id="index-search" type="search" placeholder="Search…" />
        <select id="index-signal">
          <option value="all">All signals</option>
          <option value="GO">GO</option>
          <option value="NO-GO">NO-GO</option>
          <option value="RUNNING">RUNNING</option>
          <option value="PARTIAL">PARTIAL</option>
        </select>
        <select id="index-suite"><option value="all">All suites</option></select>
        <button type="button" class="btn" id="export-pdf">Export PDF</button>
      </div>
    </header>
    <main class="main index-main">
      <div class="index-kpis" id="index-kpis"></div>
      <div class="card chart-card">
        <h2>Score by run</h2>
        <div id="index-chart" class="chart-box tall"></div>
      </div>
      <div class="card table-card">
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

function sharedCss() {
  return `
:root {
  --bg: #f4f5f7;
  --panel: #ffffff;
  --ink: #111827;
  --muted: #6b7280;
  --line: #e5e7eb;
  --accent: #0f766e;
  --pass: #059669;
  --fail: #dc2626;
  --warn: #d97706;
  --info: #2563eb;
  --track: #eef0f3;
  --sans: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
  --mono: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.45 var(--sans);
  -webkit-font-smoothing: antialiased;
}
button, input, select { font: inherit; color: inherit; }
.shell { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
.bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.bar-left, .bar-right, .bar-center { display: flex; align-items: center; gap: 10px; min-width: 0; }
.bar-center { flex: 1; justify-content: center; color: var(--muted); font-size: 13px; }
.suite { font-size: 15px; letter-spacing: -0.01em; }
.link { color: var(--accent); text-decoration: none; font-weight: 600; }
.link:hover { text-decoration: underline; }
.sep { color: var(--line); }
.muted, .live { color: var(--muted); font-size: 13px; }
.signal {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--track);
  font: 700 11px/1 var(--mono);
  letter-spacing: 0.04em;
}
.signal[data-signal="GO"] { color: var(--pass); background: #ecfdf5; }
.signal[data-signal="NO-GO"] { color: var(--fail); background: #fef2f2; }
.signal[data-signal="RUNNING"], .signal[data-signal="PARTIAL"] { color: var(--info); background: #eff6ff; }
.tabs { display: inline-flex; padding: 3px; background: var(--track); border-radius: 10px; }
.tab {
  border: 0;
  background: transparent;
  padding: 7px 14px;
  border-radius: 8px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
}
.tab.active { background: var(--panel); color: var(--ink); }
.btn {
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 7px 12px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover { border-color: #cbd5e1; }
.main { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px 24px; }
.view { display: none; }
.view.active { display: block; height: 100%; }
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
}
.card h2, .card h3 {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.kpi {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
@media (max-width: 1100px) { .kpi { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 700px) { .kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.kpi .card { padding: 14px; }
.kpi .label { color: var(--muted); font-size: 12px; font-weight: 600; }
.kpi .value { margin-top: 6px; font-size: 26px; font-weight: 700; letter-spacing: -0.03em; }
.kpi .hint { margin-top: 4px; color: var(--muted); font-size: 12px; }
.chart-grid {
  display: grid;
  grid-template-columns: 240px 1fr 1.4fr;
  gap: 12px;
  margin-bottom: 12px;
}
@media (max-width: 1100px) { .chart-grid { grid-template-columns: 1fr 1fr; } .chart-grid .wide { grid-column: 1 / -1; } }
.chart-box { min-height: 180px; }
.chart-box.tall { min-height: 220px; }
.split-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 900px) { .split-2 { grid-template-columns: 1fr; } }
.bar-chart { width: 100%; overflow: visible; }
.bar-row { display: grid; grid-template-columns: 92px 1fr 54px; gap: 10px; align-items: center; margin: 8px 0; }
.bar-row .name { font-size: 13px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { height: 10px; background: var(--track); border-radius: 999px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 999px; background: var(--accent); }
.bar-fill.pass { background: var(--pass); }
.bar-fill.warn { background: var(--warn); }
.bar-fill.fail { background: var(--fail); }
.bar-row .val { text-align: right; font: 600 12px/1 var(--mono); color: var(--muted); }
.donut-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; height: 100%; min-height: 180px; }
.donut-wrap svg { display: block; }
.donut-label { text-align: center; }
.donut-label .big { font-size: 28px; font-weight: 700; letter-spacing: -0.03em; }
.donut-label .small { color: var(--muted); font-size: 12px; }
.mini-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.mini-table th, .mini-table td { text-align: left; padding: 8px 4px; border-bottom: 1px solid var(--line); }
.mini-table th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.mini-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font: 700 10px/1 var(--mono);
  background: var(--track);
}
.pill.pass { color: var(--pass); background: #ecfdf5; }
.pill.fail { color: var(--fail); background: #fef2f2; }
.pill.na { color: var(--muted); }
.fail-list { list-style: none; margin: 0; padding: 0; }
.fail-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.fail-list button {
  border: 0;
  background: none;
  padding: 0;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.fail-list .meta { color: var(--muted); white-space: nowrap; }
.empty { padding: 24px; color: var(--muted); }
.print-only { display: none; }
@media print {
  body { background: #fff; height: auto; }
  .shell { height: auto; overflow: visible; }
  .bar-right .tabs, .btn, .filters, .cases-shell { display: none !important; }
  .main { overflow: visible; padding: 0; }
  .view { display: none !important; }
  .print-only { display: block !important; padding: 12px; }
  .print-only h1 { font-size: 20px; margin: 0 0 8px; }
  .print-only h2 { font-size: 13px; margin: 18px 0 8px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
  .print-only table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .print-only th, .print-only td { border-bottom: 1px solid #e5e7eb; padding: 6px 4px; text-align: left; }
  .card, .kpi .card { break-inside: avoid; }
}
`;
}

function runCss() {
  return `
.cases-shell {
  display: grid;
  grid-template-columns: minmax(320px, 0.95fr) minmax(0, 1.25fr);
  gap: 12px;
  height: calc(100vh - 84px);
  min-height: 0;
}
@media (max-width: 960px) {
  .cases-shell { grid-template-columns: 1fr; height: auto; }
}
.cases-side, .case-detail {
  min-height: 0;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--line);
}
.filters input, .filters select {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 8px;
  padding: 7px 10px;
  min-width: 0;
}
.filters input[type="search"] { flex: 1 1 140px; }
.filters .count { margin-left: auto; color: var(--muted); font-size: 12px; font-weight: 600; }
.case-list { flex: 1; overflow: auto; }
.case-row {
  display: grid;
  grid-template-columns: 52px 1fr auto;
  gap: 10px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
.case-row:hover { background: #f9fafb; }
.case-row.active { background: #f0fdfa; }
.status { font: 700 11px/1.3 var(--mono); }
.status.pass { color: var(--pass); }
.status.fail { color: var(--fail); }
.case-row .id { font: 600 12px/1.35 var(--mono); word-break: break-all; }
.case-row .meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
.case-row .dur { color: var(--muted); font: 12px/1 var(--mono); align-self: center; }
.case-detail { padding: 16px 18px; overflow: auto; }
.case-detail h3 { margin: 6px 0 0; font: 700 15px/1.35 var(--mono); word-break: break-all; }
.case-detail h4 { margin: 16px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.kv { display: grid; grid-template-columns: 100px 1fr; gap: 6px 12px; margin: 14px 0; font-size: 13px; }
.kv dt { color: var(--muted); }
.prompt, .block {
  white-space: pre-wrap;
  word-break: break-word;
  background: #f8fafc;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  font: 12px/1.45 var(--mono);
}
.check-list { list-style: none; margin: 0; padding: 0; }
.check-list li {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.check-list .type { font-family: var(--mono); font-weight: 600; font-size: 12px; }
.check-list .details { color: var(--muted); margin-top: 2px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
`;
}

function indexCss() {
  return `
.index-main { display: flex; flex-direction: column; gap: 12px; }
.index-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .index-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.bar-right input, .bar-right select {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 8px;
  padding: 7px 10px;
}
.table-card { padding: 0; overflow: auto; }
.run-table { width: 100%; border-collapse: collapse; }
.run-table th, .run-table td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.run-table th {
  position: sticky; top: 0;
  background: #fafafa;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.run-table a { color: var(--accent); text-decoration: none; font-family: var(--mono); font-size: 12px; }
.run-table a:hover { text-decoration: underline; }
.run-table tr:hover td { background: #f9fafb; }
.score-cell { display: flex; align-items: center; gap: 10px; min-width: 140px; }
.score-cell .track { flex: 1; height: 8px; background: var(--track); border-radius: 999px; overflow: hidden; }
.score-cell .fill { height: 100%; background: var(--accent); }
@media print {
  .bar-right input, .bar-right select { display: none !important; }
  .shell, .main { overflow: visible; height: auto; }
}
`;
}

function runViewerJs() {
  return `
const data = JSON.parse(document.getElementById('run-data').textContent);
const results = Array.isArray(data.results) ? data.results.map((r, i) => ({ ...r, _index: i })) : [];

const els = {
  meta: document.getElementById('run-meta'),
  kpi: document.getElementById('kpi'),
  result: document.getElementById('chart-result'),
  difficulty: document.getElementById('chart-difficulty'),
  category: document.getElementById('chart-category'),
  gates: document.getElementById('gates-card'),
  failures: document.getElementById('failures-card'),
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
function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
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
function barRows(entries) {
  if (!entries.length) return '<div class="empty">No data</div>';
  return entries.map(([name, score, right]) => {
    const width = pctNum(score);
    return '<div class="bar-row"><div class="name" title="' + escapeText(name) + '">' + escapeText(name) +
      '</div><div class="bar-track"><div class="bar-fill ' + scoreClass(score) + '" style="width:' + width + '%"></div></div>' +
      '<div class="val">' + escapeText(right ?? pct(score)) + '</div></div>';
  }).join('');
}
function donut(passed, total) {
  const rate = total ? passed / total : 0;
  const r = 54;
  const c = 2 * Math.PI * r;
  const dash = c * rate;
  const color = scoreClass(rate) === 'pass' ? '#059669' : scoreClass(rate) === 'warn' ? '#d97706' : '#dc2626';
  return '<div class="donut-wrap"><svg width="140" height="140" viewBox="0 0 140 140">' +
    '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="#eef0f3" stroke-width="12"/>' +
    '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="12" ' +
    'stroke-linecap="round" stroke-dasharray="' + dash + ' ' + c + '" transform="rotate(-90 70 70)"/>' +
    '</svg><div class="donut-label"><div class="big">' + pct(rate) + '</div><div class="small">' +
    passed + ' passed · ' + Math.max(0, total - passed) + ' failed</div></div></div>';
}

fillSelect(els.difficultyFilter, unique('difficulty'), 'Difficulty');
fillSelect(els.categoryFilter, unique('category'), 'Category');
fillSelect(els.capabilityFilter, unique('capability'), 'Capability');

els.meta.textContent = [
  fmtTime(data.startedAt) + ' → ' + fmtTime(data.finishedAt),
  (data.completed ?? results.length) + ' / ' + (data.expectedTotal ?? results.length) + ' cases',
].join('  ·  ');

const overall = data.overall ?? {};
const usage = data.usageTotals ?? {};
els.kpi.innerHTML = [
  ['Passed', (overall.passed ?? 0) + '/' + (overall.total ?? 0), (overall.failed ?? 0) + ' failed'],
  ['Case score', pct(overall.caseScore), ''],
  ['Family score', pct(overall.familyScore), ''],
  ['Avg duration', ms(overall.avgDurationMs), ''],
  ['Input tokens', usage.inputTokens != null ? Number(usage.inputTokens).toLocaleString() : '—', ''],
  ['Output tokens', usage.outputTokens != null ? Number(usage.outputTokens).toLocaleString() : '—', ''],
].map(([label, value, hint]) =>
  '<div class="card"><div class="label">' + label + '</div><div class="value">' + value + '</div>' +
  (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'
).join('');

els.result.innerHTML = donut(overall.passed ?? 0, overall.total ?? 0);

const difficulties = data.difficulties ?? {};
els.difficulty.innerHTML = barRows(
  ['easy', 'medium', 'hard']
    .filter((d) => (difficulties[d]?.total ?? 0) > 0)
    .map((d) => [d, difficulties[d].familyScore ?? 0, pct(difficulties[d].familyScore)])
);

const categories = Object.entries(data.byCategory ?? {})
  .filter(([, v]) => (v?.total ?? 0) > 0)
  .sort((a, b) => (a[1].caseScore ?? 0) - (b[1].caseScore ?? 0) || a[0].localeCompare(b[0]));
els.category.innerHTML = barRows(categories.map(([name, item]) => [name, item.caseScore ?? 0, item.passed + '/' + item.total]));

els.gates.innerHTML = '<h2>Difficulty gates</h2><table class="mini-table"><thead><tr>' +
  '<th>Difficulty</th><th class="num">Passed</th><th class="num">Score</th><th>Gate</th></tr></thead><tbody>' +
  ['easy', 'medium', 'hard'].map((d) => {
    const item = difficulties[d] ?? { passed: 0, total: 0, familyScore: 0 };
    if (!item.total) return '';
    return '<tr><td>' + d + '</td><td class="num">' + item.passed + '/' + item.total +
      '</td><td class="num">' + pct(item.familyScore) + '</td><td>' + gatePill((data.gateResults ?? {})[d]) + '</td></tr>';
  }).join('') + '</tbody></table>';

const failed = results.filter((r) => !r.passed);
els.failures.innerHTML = '<h2>Failed cases (' + failed.length + ')</h2>' +
  (failed.length
    ? '<ul class="fail-list">' + failed.map((r) =>
        '<li><button type="button" data-open="' + encodeURIComponent(r.id) + '">' + escapeText(r.id) +
        '</button><span class="meta">' + escapeText([r.difficulty, r.category].filter(Boolean).join(' · ')) + '</span></li>'
      ).join('') + '</ul>'
    : '<div class="empty">No failures in this run.</div>');

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
  if (!rows.length) {
    els.list.innerHTML = '<div class="empty">No cases match.</div>';
    return;
  }
  els.list.innerHTML = rows.map((r) =>
    '<div class="case-row' + (r.id === selectedId ? ' active' : '') + '" data-id="' + encodeURIComponent(r.id) + '">' +
    '<div class="status ' + (r.passed ? 'pass' : 'fail') + '">' + (r.passed ? 'PASS' : 'FAIL') + '</div>' +
    '<div><div class="id">' + escapeText(r.id) + '</div><div class="meta">' +
    escapeText([r.difficulty, r.category, r.capability].filter(Boolean).join(' · ')) +
    '</div></div><div class="dur">' + ms(r.durationMs) + '</div></div>'
  ).join('');
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
    kv('Tokens', [usage.inputTokens != null ? 'in ' + usage.inputTokens : null, usage.outputTokens != null ? 'out ' + usage.outputTokens : null].filter(Boolean).join(' · ') || '—') +
    kv('Calls', [usage.modelCalls != null ? usage.modelCalls + ' model' : null, usage.toolCalls != null ? usage.toolCalls + ' tool' : null].filter(Boolean).join(' · ') || '—') +
    '</dl>' +
    (r.error ? '<h4>Error</h4><div class="block">' + escapeText(r.error) + '</div>' : '') +
    '<h4>Prompt</h4><div class="prompt">' + escapeText(r.prompt || '(empty)') + '</div>' +
    (pre ? '<h4>Preconditions</h4><ul class="check-list">' + pre + '</ul>' : '') +
    '<h4>Checks</h4><ul class="check-list">' + (checks || '<li class="muted">No checks</li>') + '</ul>';
  renderList();
}

function buildPrintSummary() {
  const failRows = failed.map((r) =>
    '<tr><td>' + escapeText(r.id) + '</td><td>' + escapeText(r.difficulty || '') +
    '</td><td>' + escapeText(r.category || '') + '</td><td>' + ms(r.durationMs) + '</td></tr>'
  ).join('');
  const catRows = categories.map(([name, item]) =>
    '<tr><td>' + escapeText(name) + '</td><td>' + item.passed + '/' + item.total +
    '</td><td>' + pct(item.caseScore) + '</td></tr>'
  ).join('');
  els.print.innerHTML =
    '<h1>Benchmark · ' + escapeText(data.suite || '') + ' · ' + escapeText(data.signal || '') + '</h1>' +
    '<p>' + escapeText(data.runId || '') + '<br/>' + escapeText(els.meta.textContent) + '</p>' +
    '<p><strong>Passed</strong> ' + (overall.passed ?? 0) + '/' + (overall.total ?? 0) +
    ' · <strong>Case</strong> ' + pct(overall.caseScore) +
    ' · <strong>Family</strong> ' + pct(overall.familyScore) + '</p>' +
    '<h2>Categories</h2><table><thead><tr><th>Category</th><th>Passed</th><th>Score</th></tr></thead><tbody>' +
    catRows + '</tbody></table>' +
    '<h2>Failed cases</h2>' +
    (failRows
      ? '<table><thead><tr><th>ID</th><th>Difficulty</th><th>Category</th><th>Duration</th></tr></thead><tbody>' + failRows + '</tbody></table>'
      : '<p>None</p>');
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
});
els.list.addEventListener('click', (event) => {
  const row = event.target.closest('.case-row');
  if (!row) return;
  renderDetail(decodeURIComponent(row.dataset.id));
});
els.failures.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-open]');
  if (!btn) return;
  showTab('cases');
  renderDetail(decodeURIComponent(btn.dataset.open));
});
for (const el of [els.search, els.status, els.difficultyFilter, els.categoryFilter, els.capabilityFilter, els.sort]) {
  el.addEventListener('input', renderList);
  el.addEventListener('change', renderList);
}
document.getElementById('export-pdf').addEventListener('click', () => {
  buildPrintSummary();
  window.print();
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
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
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
    '<div class="card"><div class="label">' + label + '</div><div class="value">' + value + '</div>' +
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
