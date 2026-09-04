import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadCases, listSuites, loadSuiteManifest } from './cases.mjs';
import { sharedCss } from './html-report.mjs';

/**
 * Generates a single, read-only, static HTML page for browsing every
 * benchmark case (prompt, fixture, checks, preconditions) — no editing,
 * just search/filter/inspect. Written to <reportRoot>/cases.html.
 */
export function generateCasesViewer(rootDir, reportRoot) {
  const suites = listSuites(rootDir);
  const manifestBySuite = Object.fromEntries(
    suites.map((suiteId) => [suiteId, loadSuiteManifest(rootDir, suiteId)])
  );
  const cases = loadCases(rootDir, { suite: 'all' }).map((c) => ({
    id: c.id,
    familyId: c.familyId,
    variant: c.variant,
    suite: c.suite,
    sourceFile: c.sourceFile,
    category: c.category,
    difficulty: c.difficulty,
    mode: c.mode,
    capability: c.capability,
    fixture: c.fixture,
    prompt: c.prompt,
    rationale: c.rationale,
    timeoutMs: c.timeoutMs ?? null,
    preconditions: c.preconditions ?? [],
    checks: c.checks ?? [],
  }));

  const outPath = join(reportRoot, 'cases.html');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderCasesHtml(cases, suites, manifestBySuite), 'utf8');
  return outPath;
}

function renderCasesHtml(cases, suites, manifestBySuite) {
  const dataJson = JSON.stringify(cases).replaceAll('</', '<\\/');
  const suitesJson = JSON.stringify(
    suites.map((suiteId) => ({
      id: suiteId,
      name: manifestBySuite[suiteId]?.name ?? suiteId,
      caseFiles: manifestBySuite[suiteId]?.caseFiles ?? [],
    }))
  ).replaceAll('</', '<\\/');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Benchmark test cases</title>
  <style>${sharedCss()}${casesCss()}</style>
</head>
<body class="cases-page">
  <div class="shell">
    <header class="bar">
      <div class="bar-left">
        <strong class="suite">Test case viewer</strong>
        <span class="muted" id="cases-meta"></span>
      </div>
      <div class="bar-right">
        <input id="cases-search" type="search" placeholder="Search id, prompt, fixture…" />
        <select id="cases-suite"><option value="all">All suites</option></select>
        <select id="cases-file"><option value="all">All files</option></select>
        <select id="cases-difficulty">
          <option value="all">All difficulty</option>
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>
        <select id="cases-capability"><option value="all">All capabilities</option></select>
        <a class="link" href="index.html">&larr; Runs</a>
      </div>
    </header>
    <main class="main cases-main">
      <div class="cases-shell">
        <div class="card cases-list-card">
          <div class="cases-list-header">
            <span id="cases-count" class="muted"></span>
          </div>
          <div id="cases-list" class="cases-list"></div>
        </div>
        <div class="card cases-detail-card">
          <div id="cases-detail" class="cases-detail empty">Select a case to view its full prompt, fixture, preconditions, and checks.</div>
        </div>
      </div>
    </main>
  </div>
  <script id="cases-data" type="application/json">${dataJson}</script>
  <script id="suites-data" type="application/json">${suitesJson}</script>
  <script>${casesViewerJs()}</script>
</body>
</html>
`;
}

function casesCss() {
  return `
.cases-main { padding: 16px 20px 24px; }
.cases-shell { display: grid; grid-template-columns: 420px 1fr; gap: 12px; height: calc(100vh - 88px); }
@media (max-width: 900px) { .cases-shell { grid-template-columns: 1fr; height: auto; } }
.cases-list-card, .cases-detail-card { display: flex; flex-direction: column; min-height: 0; padding: 0; overflow: hidden; }
.cases-list-header { padding: 12px 14px; border-bottom: 1px solid var(--line); flex: 0 0 auto; }
.cases-list { overflow: auto; flex: 1; }
.case-row {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  padding: 10px 14px;
  cursor: pointer;
}
.case-row:hover { background: var(--track); }
.case-row.active { background: #ecfdf5; }
.case-row .row-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.case-row .row-id { font: 700 12px/1.3 var(--mono); color: var(--ink); word-break: break-all; }
.case-row .row-prompt { margin-top: 4px; color: var(--muted); font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.case-row .row-meta { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
.cases-detail { overflow: auto; flex: 1; padding: 18px; }
.cases-detail.empty { display: flex; align-items: center; justify-content: center; color: var(--muted); text-align: center; }
.detail-title { font: 700 15px/1.4 var(--mono); word-break: break-all; margin-bottom: 4px; }
.detail-family { color: var(--muted); font-size: 12.5px; margin-bottom: 12px; }
.detail-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.detail-section { margin-bottom: 18px; }
.detail-section h3 { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.detail-prompt { background: var(--track); border-radius: 8px; padding: 12px 14px; font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; }
.detail-rationale { color: var(--ink); font-size: 13px; line-height: 1.5; }
.check-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.check-item { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: 12px/1.5 var(--mono); background: var(--panel); }
.check-item .check-type { font-weight: 700; color: var(--accent); }
.check-item .check-rest { color: var(--muted); white-space: pre-wrap; word-break: break-word; }
.pill.fixture { color: var(--info); background: #eff6ff; }
.pill.capability { color: var(--accent); background: #ecfdf5; }
.pill.mode { color: var(--warn); background: #fffbeb; }
.pill.difficulty-easy { color: var(--pass); background: #ecfdf5; }
.pill.difficulty-medium { color: var(--warn); background: #fffbeb; }
.pill.difficulty-hard { color: var(--fail); background: #fef2f2; }
.pill.file { color: var(--muted); background: var(--track); }
`;
}

function casesViewerJs() {
  return `
(function () {
  var cases = JSON.parse(document.getElementById('cases-data').textContent);
  var suites = JSON.parse(document.getElementById('suites-data').textContent);
  var state = { suite: 'all', file: 'all', difficulty: 'all', capability: 'all', search: '', activeId: null };

  var suiteSelect = document.getElementById('cases-suite');
  var fileSelect = document.getElementById('cases-file');
  var difficultySelect = document.getElementById('cases-difficulty');
  var capabilitySelect = document.getElementById('cases-capability');
  var searchInput = document.getElementById('cases-search');
  var listEl = document.getElementById('cases-list');
  var countEl = document.getElementById('cases-count');
  var metaEl = document.getElementById('cases-meta');
  var detailEl = document.getElementById('cases-detail');

  metaEl.textContent = cases.length + ' case' + (cases.length === 1 ? '' : 's') + ' across ' + suites.length + ' suite' + (suites.length === 1 ? '' : 's');

  suites.forEach(function (s) {
    var opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name + ' (' + s.id + ')';
    suiteSelect.appendChild(opt);
  });

  unique(cases, 'capability').forEach(function (cap) {
    var opt = document.createElement('option');
    opt.value = cap;
    opt.textContent = cap;
    capabilitySelect.appendChild(opt);
  });

  function unique(items, key) {
    var seen = {};
    var out = [];
    items.forEach(function (item) {
      var v = item[key];
      if (v == null || seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    out.sort();
    return out;
  }

  function refreshFileOptions() {
    var files = state.suite === 'all'
      ? unique(cases, 'sourceFile')
      : (suites.filter(function (s) { return s.id === state.suite; })[0] || { caseFiles: [] }).caseFiles;
    fileSelect.innerHTML = '<option value="all">All files</option>';
    files.forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      fileSelect.appendChild(opt);
    });
  }

  function filtered() {
    var q = state.search.trim().toLowerCase();
    return cases.filter(function (c) {
      if (state.suite !== 'all' && c.suite !== state.suite) return false;
      if (state.file !== 'all' && c.sourceFile !== state.file) return false;
      if (state.difficulty !== 'all' && c.difficulty !== state.difficulty) return false;
      if (state.capability !== 'all' && c.capability !== state.capability) return false;
      if (q) {
        var hay = (c.id + ' ' + c.prompt + ' ' + c.fixture + ' ' + (c.category || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function pill(text, cls) {
    return '<span class="pill ' + (cls || '') + '">' + escapeHtml(text) + '</span>';
  }

  function renderList() {
    var items = filtered();
    countEl.textContent = items.length + ' matching case' + (items.length === 1 ? '' : 's');
    listEl.innerHTML = '';
    items.forEach(function (c) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'case-row' + (c.id === state.activeId ? ' active' : '');
      row.innerHTML =
        '<div class="row-top"><span class="row-id">' + escapeHtml(c.id) + '</span></div>' +
        '<div class="row-prompt">' + escapeHtml(c.prompt) + '</div>' +
        '<div class="row-meta">' +
        pill(c.suite) +
        pill(c.difficulty, 'difficulty-' + c.difficulty) +
        pill(c.capability, 'capability') +
        pill(c.fixture, 'fixture') +
        pill(c.sourceFile, 'file') +
        '</div>';
      row.addEventListener('click', function () {
        state.activeId = c.id;
        renderList();
        renderDetail(c);
      });
      listEl.appendChild(row);
    });
    if (!items.length) {
      listEl.innerHTML = '<div class="empty">No cases match these filters.</div>';
    }
  }

  function renderCheck(check) {
    var rest = Object.keys(check).filter(function (k) { return k !== 'type'; }).map(function (k) {
      var v = check[k];
      var shown = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return k + ': ' + shown;
    }).join('  ·  ');
    return '<li class="check-item"><span class="check-type">' + escapeHtml(check.type) + '</span>' +
      (rest ? '<div class="check-rest">' + escapeHtml(rest) + '</div>' : '') + '</li>';
  }

  function renderDetail(c) {
    var pre = (c.preconditions || []).map(renderCheck).join('');
    var checks = (c.checks || []).map(renderCheck).join('');
    detailEl.className = 'cases-detail';
    detailEl.innerHTML =
      '<div class="detail-title">' + escapeHtml(c.id) + '</div>' +
      '<div class="detail-family">familyId: ' + escapeHtml(c.familyId) + '  ·  variant: ' + escapeHtml(c.variant) + '</div>' +
      '<div class="detail-pills">' +
      pill(c.suite) + pill(c.sourceFile, 'file') + pill(c.difficulty, 'difficulty-' + c.difficulty) +
      pill(c.mode, 'mode') + pill(c.capability, 'capability') + pill(c.fixture, 'fixture') +
      (c.category ? pill(c.category) : '') +
      '</div>' +
      '<div class="detail-section"><h3>Prompt</h3><div class="detail-prompt">' + escapeHtml(c.prompt) + '</div></div>' +
      (c.rationale ? '<div class="detail-section"><h3>Rationale</h3><div class="detail-rationale">' + escapeHtml(c.rationale) + '</div></div>' : '') +
      '<div class="detail-section"><h3>Preconditions (' + (c.preconditions || []).length + ')</h3><ul class="check-list">' + (pre || '<li class="check-item">None</li>') + '</ul></div>' +
      '<div class="detail-section"><h3>Checks (' + (c.checks || []).length + ')</h3><ul class="check-list">' + checks + '</ul></div>';
  }

  suiteSelect.addEventListener('change', function () {
    state.suite = suiteSelect.value;
    state.file = 'all';
    refreshFileOptions();
    renderList();
  });
  fileSelect.addEventListener('change', function () { state.file = fileSelect.value; renderList(); });
  difficultySelect.addEventListener('change', function () { state.difficulty = difficultySelect.value; renderList(); });
  capabilitySelect.addEventListener('change', function () { state.capability = capabilitySelect.value; renderList(); });
  searchInput.addEventListener('input', function () { state.search = searchInput.value; renderList(); });

  refreshFileOptions();
  renderList();
})();
`;
}
