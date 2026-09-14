const API = '/api/benchmark';
const LS_PANELS = 'mitii.benchmark.panels';
const LS_LOGS = 'mitii.benchmark.activityLogs';

const state = {
  meta: null,
  config: null,
  cases: [],
  runs: [],
  queue: [],
  selected: new Set(),
  activeId: null,
  activeRunId: null,
  activeSummary: null,
  resultRows: [],
  resultsById: new Map(),
  resultFilter: 'all',
  leftTab: 'runs',
  currentPrompt: '',
  status: { status: 'idle', total: 0, completed: 0, passed: 0, failed: 0 },
  logOpen: true,
  railOpen: true,
  inspectorOpen: true,
  modalOpen: false,
  seenLogKeys: new Set(),
  timerHandle: null,
  term: null,
  fitAddon: null,
};

const el = (id) => document.getElementById(id);
const logView = el('log-view');
const casesList = el('cases-list');
const runsList = el('runs-list');
const caseDetail = el('case-detail');
const resultsBody = el('results-body');

function loadPanelPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PANELS) || '{}');
    if (typeof raw.logOpen === 'boolean') state.logOpen = raw.logOpen;
    if (typeof raw.railOpen === 'boolean') state.railOpen = raw.railOpen;
    if (typeof raw.inspectorOpen === 'boolean') state.inspectorOpen = raw.inspectorOpen;
  } catch {
    /* ignore */
  }
}

function savePanelPrefs() {
  localStorage.setItem(
    LS_PANELS,
    JSON.stringify({
      logOpen: state.logOpen,
      railOpen: state.railOpen,
      inspectorOpen: state.inspectorOpen,
    }),
  );
}

function applyPanels() {
  document.body.dataset.logOpen = state.logOpen ? 'true' : 'false';
  document.body.dataset.railOpen = state.railOpen ? 'true' : 'false';
  document.body.dataset.inspectorOpen = state.inspectorOpen ? 'true' : 'false';
  el('btn-toggle-rail').classList.toggle('is-on', state.railOpen);
  el('btn-toggle-inspector').classList.toggle('is-on', state.inspectorOpen);
  savePanelPrefs();
  fitTerm();
}

function logKey(entry) {
  return `${entry.at || ''}|${entry.level || ''}|${entry.message || ''}`;
}

function persistLogs() {
  const lines = [...logView.querySelectorAll('div')].slice(-400).map((node) => ({
    level: node.className || 'info',
    message: node.textContent.replace(/^\[[^\]]+\]\s*/, ''),
    at: new Date().toISOString(),
  }));
  try {
    sessionStorage.setItem(LS_LOGS, JSON.stringify(lines));
  } catch {
    /* quota */
  }
}

function appendLog(level, message, meta = {}) {
  const entry = {
    at: meta.at || new Date().toISOString(),
    level: level || 'info',
    message: String(message ?? ''),
  };
  const key = logKey(entry);
  if (state.seenLogKeys.has(key)) return;
  state.seenLogKeys.add(key);
  if (state.seenLogKeys.size > 4000) {
    state.seenLogKeys = new Set([...state.seenLogKeys].slice(-2000));
  }

  const line = document.createElement('div');
  line.className = entry.level;
  const ts = new Date(entry.at).toLocaleTimeString();
  line.textContent = `[${ts}] ${entry.message}`;
  logView.appendChild(line);
  if (el('f-autoscroll').checked) logView.scrollTop = logView.scrollHeight;
  el('activity-sub').textContent = `${logView.childElementCount} events`;
  writeTerm(entry.level, entry.message);
  persistLogs();
}

function replayLogs(logs) {
  if (!Array.isArray(logs)) return;
  for (const entry of logs) {
    appendLog(entry.level || 'info', entry.message || '', { at: entry.at });
  }
}

function clearLog({ keepTerm = false } = {}) {
  logView.innerHTML = '';
  state.seenLogKeys.clear();
  el('activity-sub').textContent = 'Live feed';
  sessionStorage.removeItem(LS_LOGS);
  if (!keepTerm && state.term) {
    state.term.clear();
    state.term.writeln('\x1b[90mActivity cleared\x1b[0m');
  }
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function busy() {
  const s = state.status.status;
  return s === 'running' || s === 'stopping' || s === 'resetting';
}

function setKpis({ signal, passed, failed, score, completed, total }) {
  const sig = el('kpi-signal');
  sig.textContent = signal || '—';
  sig.className = `signal-text ${signal || ''}`;
  el('kpi-passed').textContent = String(passed ?? 0);
  el('kpi-failed').textContent = String(failed ?? 0);
  el('kpi-score').textContent =
    score == null || !Number.isFinite(score) ? '—' : `${Math.round(score * 1000) / 10}%`;
  el('kpi-progress').textContent = total ? `${completed ?? 0}/${total}` : '—';
  const pct = total ? Math.round((100 * (completed ?? 0)) / total) : 0;
  el('progress-fill').style.width = `${pct}%`;
}

function renderStagePills(hostId, stage) {
  const host = el(hostId);
  if (!host) return;
  const order = ['prepare', 'preconditions', 'agent', 'verify'];
  const doneSet = new Set();
  const idx = order.indexOf(stage);
  if (stage === 'passed' || stage === 'failed') order.forEach((s) => doneSet.add(s));
  else if (idx >= 0) order.slice(0, idx).forEach((s) => doneSet.add(s));
  host.innerHTML = order
    .map((s) => {
      const cls = s === stage ? 'stage-pill active' : doneSet.has(s) ? 'stage-pill done' : 'stage-pill';
      return `<span class="${cls}">${s}</span>`;
    })
    .join('');
}

function ensureTerm() {
  if (state.term || !window.Terminal) return;
  const Fit = window.FitAddon?.FitAddon || window.FitAddon;
  state.term = new window.Terminal({
    convertEol: true,
    fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
    theme: {
      background: '#000000',
      foreground: '#d7e3f4',
      cursor: '#ff751f',
      selectionBackground: '#243247',
    },
  });
  if (Fit) {
    state.fitAddon = new Fit();
    state.term.loadAddon(state.fitAddon);
  }
  state.term.open(el('live-term'));
  fitTerm();
  state.term.writeln('\x1b[36mMitii live terminal ready\x1b[0m');
}

function fitTerm() {
  try {
    state.fitAddon?.fit();
  } catch {
    /* not visible yet */
  }
}

function writeTerm(level, message) {
  if (!state.term) return;
  const color =
    level === 'pass' ? '32' : level === 'fail' ? '31' : level === 'warn' ? '33' : level === 'stream' ? '35' : '36';
  state.term.writeln(`\x1b[${color}m${message}\x1b[0m`);
}

function openLiveModal() {
  state.modalOpen = true;
  el('live-modal').hidden = false;
  ensureTerm();
  fitTerm();
  updateLiveModal();
}

function closeLiveModal({ minimize = true } = {}) {
  state.modalOpen = false;
  el('live-modal').hidden = true;
  if (minimize && busy()) {
    el('live-strip').hidden = false;
  }
}

function updateLiveModal() {
  const s = state.status;
  const running = busy();
  el('live-strip').hidden = !(running && !state.modalOpen);

  const total = s.total || 0;
  const completed = s.completed || 0;
  const left = Math.max(0, total - completed);
  const pct = total ? Math.round((100 * completed) / total) : 0;

  el('live-progress').textContent = `${completed} / ${total}`;
  el('live-progress-fill').style.width = `${pct}%`;
  el('live-passed').textContent = String(s.passed || 0);
  el('live-failed').textContent = String(s.failed || 0);
  el('live-left').textContent = String(left);
  el('live-case-timer').textContent = fmtMs(s.caseElapsedMs || 0);
  el('live-run-timer').textContent = fmtMs(s.elapsedMs || 0);
  el('live-run-id').textContent = s.runId || '';
  el('live-title').textContent =
    s.status === 'stopping' ? 'Stopping…' : running ? 'Benchmark in progress' : 'Run finished';

  const caseId = s.currentCaseId || (running ? 'starting…' : '—');
  el('live-case').textContent = caseId;
  el('live-case-meta').textContent = [
    s.suite || '',
    s.currentCaseIndex != null ? `${s.currentCaseIndex + 1}/${total}` : '',
    s.currentStage || '',
  ]
    .filter(Boolean)
    .join(' · ');
  el('live-stage-detail').textContent = s.currentStageDetail || '—';
  el('live-prompt').textContent = state.currentPrompt || '';
  renderStagePills('live-stage-pills', s.currentStage || 'prepare');

  el('live-strip-title').textContent = running ? `Running · ${caseId}` : 'Run';
  el('live-strip-meta').textContent = `${completed}/${total} done · ${left} left · ${s.currentStageDetail || s.currentStage || ''}`;

  renderQueue();
}

function renderQueue() {
  const host = el('live-queue');
  const current = state.status.currentCaseId;
  const rows = state.queue.length
    ? state.queue
    : state.resultRows.map((r) => ({ id: r.id, passed: r.passed, done: r.durationMs != null }));

  if (!rows.length) {
    host.innerHTML = '<div class="muted">Queue will appear when the run starts.</div>';
    return;
  }

  host.innerHTML = rows
    .slice(0, 80)
    .map((item) => {
      const result = state.resultsById.get(item.id);
      const done = result && result.durationMs != null;
      const cls =
        item.id === current
          ? 'queue-item current'
          : done
            ? result.passed
              ? 'queue-item done-pass'
              : 'queue-item done-fail'
            : 'queue-item';
      const label = item.id === current ? 'NOW' : done ? (result.passed ? 'PASS' : 'FAIL') : 'WAIT';
      return `<div class="${cls}"><span>${escapeHtml(item.id)}</span><strong>${label}</strong></div>`;
    })
    .join('');
}

function tickTimers() {
  const s = state.status;
  if (s.startedAt) s.elapsedMs = Date.now() - new Date(s.startedAt).getTime();
  if (s.caseStartedAt) s.caseElapsedMs = Date.now() - new Date(s.caseStartedAt).getTime();
  if (busy()) updateLiveModal();
}

function updateStatus(status) {
  state.status = { ...state.status, ...(status || {}) };
  const s = state.status;
  const pill = el('run-pill');
  pill.textContent = s.currentCaseId
    ? `${s.status} · ${s.currentCaseId.slice(0, 28)}`
    : s.status + (s.runId ? ` · ${String(s.runId).slice(0, 18)}` : '');
  pill.className = `status-chip ${s.status || 'idle'}`;

  const isBusy = busy();
  el('btn-start').disabled = isBusy;
  el('btn-stop').disabled = s.status !== 'running';
  el('btn-live-stop').disabled = s.status !== 'running';
  el('btn-run-selected').disabled = isBusy;
  el('btn-run-one').disabled = !state.activeId || isBusy;
  el('btn-reset-fixtures').disabled = isBusy;
  el('btn-save-config').disabled = isBusy;

  if (!state.activeRunId || state.activeRunId === s.runId) {
    setKpis({
      signal: isBusy ? 'RUNNING' : state.activeSummary?.signal,
      passed: s.passed,
      failed: s.failed,
      score: s.total ? s.passed / s.total : null,
      completed: s.completed,
      total: s.total,
    });
  }

  if (isBusy) {
    if (!state.modalOpen) el('live-strip').hidden = false;
    if (!state.timerHandle) state.timerHandle = setInterval(tickTimers, 1000);
    // Auto-open live console when a run is active (including after refresh).
    if (!state.modalOpen && !el('live-modal').dataset.userMinimized) openLiveModal();
    state.logOpen = true;
    applyPanels();
  } else {
    if (state.timerHandle) {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
    }
    el('live-strip').hidden = true;
    delete el('live-modal').dataset.userMinimized;
  }

  updateLiveModal();

  if (Array.isArray(s.results) && s.results.length && (!state.activeRunId || state.activeRunId === s.runId)) {
    for (const r of s.results) state.resultsById.set(r.id, r);
    const byId = new Map(state.resultRows.map((r) => [r.id, r]));
    for (const r of s.results) byId.set(r.id, { ...byId.get(r.id), ...r, running: false });
    if (s.currentCaseId && !byId.has(s.currentCaseId)) {
      byId.set(s.currentCaseId, { id: s.currentCaseId, running: true, suite: s.suite });
    }
    state.resultRows = [...byId.values()];
    renderResults();
    if (state.leftTab === 'cases') renderCases();
  } else if (s.currentCaseId) {
    renderResults();
  }
}

function setLeftTab(tab) {
  state.leftTab = tab;
  el('tab-cases').classList.toggle('is-active', tab === 'cases');
  el('tab-runs').classList.toggle('is-active', tab === 'runs');
  casesList.hidden = tab !== 'cases';
  runsList.hidden = tab !== 'runs';
  el('cases-actions').hidden = tab !== 'cases';
  el('cases-foot').hidden = tab !== 'cases';
  el('runs-actions').hidden = tab !== 'runs';
  if (tab === 'cases') renderCases();
  else renderRuns();
}

function railQuery() {
  return el('f-search').value.trim().toLowerCase();
}

function rerunCase(caseId, event) {
  if (event) event.stopPropagation();
  if (!caseId || busy()) return;
  appendLog('info', `Re-running single case: ${caseId}`);
  startRun({ ids: [caseId], suite: 'all' });
}

function renderCases() {
  const q = railQuery();
  const rows = state.cases.filter((c) => {
    if (!q) return true;
    return (
      c.id.toLowerCase().includes(q) ||
      c.prompt.toLowerCase().includes(q) ||
      (c.fixture || '').toLowerCase().includes(q)
    );
  });
  casesList.innerHTML = '';
  for (const c of rows) {
    const result = state.resultsById.get(c.id);
    const isRunning = state.status.currentCaseId === c.id;
    const row = document.createElement('button');
    row.type = 'button';
    row.className =
      'case-row' +
      (state.activeId === c.id ? ' active' : '') +
      (isRunning ? ' running-case' : '');
    const checked = state.selected.has(c.id);
    row.innerHTML =
      `<input type="checkbox" ${checked ? 'checked' : ''} />` +
      `<div><div class="id">${escapeHtml(c.id)}</div>` +
      `<div class="prompt">${escapeHtml(c.prompt)}</div>` +
      `<div class="meta"><span class="pill">${escapeHtml(c.difficulty)}</span>` +
      `<span class="pill">${escapeHtml(c.suite || '')}</span></div></div>` +
      `<span class="status-dot ${
        isRunning ? 'run' : result ? (result.passed ? 'pass' : 'fail') : ''
      }"></span>`;
    row.querySelector('input').addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.checked) state.selected.add(c.id);
      else state.selected.delete(c.id);
    });
    row.addEventListener('click', () => {
      state.activeId = c.id;
      renderCases();
      showCaseDetail(c, result);
    });
    casesList.appendChild(row);
  }
}

function renderRuns() {
  const q = railQuery();
  const rows = state.runs.filter((run) => {
    if (!q) return true;
    return (
      run.runId.toLowerCase().includes(q) ||
      (run.suite || '').toLowerCase().includes(q) ||
      (run.signal || '').toLowerCase().includes(q)
    );
  });
  runsList.innerHTML = '';
  if (!rows.length) {
    runsList.innerHTML = '<div class="empty-hint">No past runs found.</div>';
    return;
  }
  for (const run of rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'run-row' + (state.activeRunId === run.runId ? ' active' : '');
    const score = Math.round((run.caseScore || 0) * 1000) / 10;
    const when = run.startedAt ? new Date(run.startedAt).toLocaleString() : '';
    row.innerHTML =
      `<div class="run-top"><span class="signal signal-${escapeHtml(run.signal)}">${escapeHtml(
        run.signal,
      )}</span><span class="pill">${escapeHtml(run.suite)}</span></div>` +
      `<div class="id">${escapeHtml(run.runId)}</div>` +
      `<div class="meta">${run.passed} pass · ${run.failed} fail` +
      (Number.isFinite(score) ? ` · ${score}%` : '') +
      `</div>` +
      `<div class="muted" style="font-size:11px;margin-top:3px">${escapeHtml(when)}</div>`;
    row.addEventListener('click', () => loadRunResults(run.runId));
    runsList.appendChild(row);
  }
}

function renderResults() {
  const filter = state.resultFilter;
  let rows = state.resultRows.slice();
  const runningId = state.status.currentCaseId;
  if (runningId && busy() && !rows.some((r) => r.id === runningId)) {
    rows.unshift({ id: runningId, running: true, suite: state.status.suite });
  }
  if (filter === 'fail') rows = rows.filter((r) => r.running || !r.passed);
  if (filter === 'pass') rows = rows.filter((r) => r.passed);

  resultsBody.innerHTML = '';
  if (!rows.length) {
    resultsBody.innerHTML =
      '<tr class="empty-row"><td colspan="7">No results yet. Start a suite or open a past run.</td></tr>';
    return;
  }

  for (const r of rows) {
    const isRunning = r.running || (busy() && r.id === runningId && r.durationMs == null);
    const tr = document.createElement('tr');
    if (state.activeId === r.id) tr.classList.add('active');
    if (isRunning) tr.classList.add('is-running');
    const statusBadge = isRunning
      ? '<span class="badge run">RUNNING</span>'
      : `<span class="badge ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'PASS' : 'FAIL'}</span>`;
    tr.innerHTML =
      `<td>${statusBadge}</td>` +
      `<td><div class="case-id">${escapeHtml(r.id)}</div></td>` +
      `<td>${escapeHtml(r.suite || '')}</td>` +
      `<td>${escapeHtml(r.difficulty || '')}</td>` +
      `<td>${isRunning ? fmtMs(state.status.caseElapsedMs) : fmtMs(r.durationMs)}</td>` +
      `<td class="err" title="${escapeHtml(r.error || '')}">${escapeHtml(
        r.error || (isRunning ? state.status.currentStageDetail || '' : ''),
      )}</td>` +
      `<td><button type="button" class="btn-rerun" data-rerun="${escapeHtml(r.id)}" ${
        busy() ? 'disabled' : ''
      }>Re-run</button></td>`;
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-rerun]')) return;
      state.activeId = r.id;
      renderResults();
      showResultDetail(r);
    });
    tr.querySelector('[data-rerun]').addEventListener('click', (e) => rerunCase(r.id, e));
    resultsBody.appendChild(tr);
  }
}

async function showResultDetail(r) {
  el('btn-run-one').disabled = busy() || !r?.id;
  state.activeId = r.id;
  state.resultsById.set(r.id, r);
  state.inspectorOpen = true;
  applyPanels();

  let checksHtml = '';
  let stdout = r.stdout || '';
  let checks = r.checks || [];
  const runId = state.activeRunId || state.status.runId;
  if (runId && !r.running) {
    try {
      const data = await api(
        `${API}/runs/${encodeURIComponent(runId)}/cases/${encodeURIComponent(r.id)}`,
      );
      if (data.result) {
        checks = data.result.checks || checks;
        stdout = data.result.stdout || stdout;
        if (data.result.error && !r.error) r = { ...r, error: data.result.error };
        if (data.result.prompt && !r.prompt) r = { ...r, prompt: data.result.prompt };
      }
    } catch {
      /* ignore */
    }
  }

  if (checks.length) {
    checksHtml =
      `<div class="detail-section"><h3>Checks (${checks.filter((c) => c.passed).length}/${checks.length})</h3>` +
      checks
        .map(
          (ch) =>
            `<div class="check-item ${ch.passed ? 'pass' : 'fail'}"><strong>${escapeHtml(
              ch.type,
            )}</strong> ${ch.passed ? 'PASS' : 'FAIL'}` +
            (ch.details ? `<div>${escapeHtml(String(ch.details).slice(0, 800))}</div>` : '') +
            `</div>`,
        )
        .join('') +
      `</div>`;
  }

  const isRunning = busy() && state.status.currentCaseId === r.id;
  caseDetail.className = 'case-detail';
  caseDetail.innerHTML =
    `<div class="detail-title">${escapeHtml(r.id)}</div>` +
    `<div class="meta" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">` +
    (isRunning
      ? `<span class="badge run">RUNNING</span>`
      : `<span class="badge ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'PASS' : 'FAIL'}</span>`) +
    `<span class="pill">${escapeHtml(r.difficulty || '')}</span>` +
    `<span class="pill">${escapeHtml(r.suite || '')}</span>` +
    `<button type="button" class="btn-rerun" id="btn-rerun-detail" ${busy() ? 'disabled' : ''}>Re-run this case</button>` +
    `</div>` +
    (r.prompt || state.currentPrompt
      ? `<div class="detail-prompt">${escapeHtml(r.prompt || state.currentPrompt)}</div>`
      : '') +
    (r.error
      ? `<div class="detail-section"><h3>Error</h3><div class="check-item fail">${escapeHtml(
          r.error,
        )}</div></div>`
      : '') +
    checksHtml +
    (stdout
      ? `<div class="detail-section"><h3>Stdout</h3><pre class="stdout-box">${escapeHtml(
          stdout.slice(0, 12000),
        )}</pre></div>`
      : '');
  el('btn-rerun-detail')?.addEventListener('click', (e) => rerunCase(r.id, e));
}

async function showCaseDetail(c, result) {
  if (result) return showResultDetail({ ...c, ...result });
  state.activeId = c.id;
  state.inspectorOpen = true;
  applyPanels();
  el('btn-run-one').disabled = busy();
  caseDetail.className = 'case-detail';
  caseDetail.innerHTML =
    `<div class="detail-title">${escapeHtml(c.id)}</div>` +
    `<div class="meta" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">` +
    `<span class="pill">${escapeHtml(c.difficulty)}</span>` +
    `<span class="pill">${escapeHtml(c.suite)}</span>` +
    `<button type="button" class="btn-rerun" id="btn-rerun-detail" ${busy() ? 'disabled' : ''}>Run this case</button>` +
    `</div>` +
    `<div class="detail-prompt">${escapeHtml(c.prompt)}</div>`;
  el('btn-rerun-detail')?.addEventListener('click', (e) => rerunCase(c.id, e));
}

async function loadRunResults(runId) {
  state.activeRunId = runId;
  state.activeId = null;
  renderRuns();
  el('results-subtitle').textContent = 'Loading…';
  try {
    const summary = await api(`${API}/runs/${encodeURIComponent(runId)}`);
    state.activeSummary = summary;
    const link = el('link-run-viewer');
    link.hidden = !summary.viewerUrl;
    link.href = summary.viewerUrl || '#';
    const results = Array.isArray(summary.results) ? summary.results : [];
    state.resultRows = results;
    state.resultsById = new Map(results.map((r) => [r.id, r]));
    renderResults();
    const passed = summary.overall?.passed ?? results.filter((r) => r.passed).length;
    const failed = summary.overall?.failed ?? results.filter((r) => !r.passed).length;
    const total = summary.completed ?? results.length;
    setKpis({
      signal: summary.signal,
      passed,
      failed,
      score: summary.overall?.caseScore ?? (total ? passed / total : null),
      completed: total,
      total: summary.expectedTotal || total,
    });
    el('results-subtitle').textContent = `${summary.signal} · ${passed} passed · ${failed} failed`;
    caseDetail.className = 'case-detail empty';
    caseDetail.textContent = `Loaded ${results.length} results. Click a row to inspect, or Re-run one case.`;
    appendLog('info', `Loaded run ${runId}: ${summary.signal} (${passed}/${total})`);
  } catch (err) {
    appendLog('fail', String(err.message || err));
  }
}

async function loadCases() {
  const suite = el('f-suite').value || 'all';
  const difficulty = el('f-difficulty').value || '';
  const qs = new URLSearchParams({ suite });
  if (difficulty) qs.set('difficulty', difficulty);
  const data = await api(`${API}/cases?${qs.toString()}`);
  state.cases = data.cases || [];
  state.selected = new Set();
  renderCases();
}

async function loadRuns() {
  const data = await api(`${API}/runs`);
  state.runs = data.runs || [];
  renderRuns();
  el('meta-line').textContent =
    `${state.meta?.totalCases || 0} cases · ${state.runs.length} past runs` +
    (state.config?.model ? ` · ${state.config.provider || 'model'}:${state.config.model}` : '');
}

async function loadConfig() {
  const cfg = await api(`${API}/config`);
  state.config = cfg;
  el('cfg-provider').value = cfg.provider || '';
  el('cfg-base-url').value = cfg.baseUrl || '';
  el('cfg-model').value = cfg.model || '';
  el('cfg-timeout').value = cfg.timeoutMs || '';
  el('cfg-api-key').value = '';
  el('cfg-clear-key').checked = false;
  el('cfg-status').textContent = cfg.apiKeySet ? 'API key set' : 'No API key in config/env';
}

async function startRun(extra) {
  const body = {
    suite: el('f-suite').value || 'all',
    difficulty: el('f-difficulty').value || undefined,
    concurrency: Number(el('f-concurrency').value || 1),
    keepWorkspaces: el('f-keep').checked,
    ...extra,
  };
  if (body.ids && body.ids.length === 0) delete body.ids;

  // Build queue preview for the live modal.
  if (body.ids?.length) {
    state.queue = body.ids.map((id) => ({ id }));
  } else {
    const suite = body.suite || 'all';
    const difficulty = body.difficulty || '';
    state.queue = state.cases
      .filter((c) => (suite === 'all' || c.suite === suite) && (!difficulty || c.difficulty === difficulty))
      .map((c) => ({ id: c.id }));
  }

  state.activeRunId = null;
  state.activeSummary = null;
  state.resultRows = [];
  state.currentPrompt = '';
  clearLog();
  delete el('live-modal').dataset.userMinimized;
  renderResults();
  el('results-subtitle').textContent = 'Live run in progress…';
  el('link-run-viewer').hidden = true;
  appendLog('info', 'Requesting run…');
  if (body.ids?.length === 1) appendLog('info', `Single-case mode: ${body.ids[0]}`);
  const status = await api(`${API}/run`, { method: 'POST', body: JSON.stringify(body) });
  state.activeRunId = status.runId;
  updateStatus(status);
  openLiveModal();
}

// Panel toggles
el('btn-toggle-log').addEventListener('click', () => {
  state.logOpen = !state.logOpen;
  applyPanels();
});
el('btn-close-log').addEventListener('click', () => {
  state.logOpen = false;
  applyPanels();
});
el('btn-toggle-rail').addEventListener('click', () => {
  state.railOpen = !state.railOpen;
  applyPanels();
});
el('btn-collapse-rail').addEventListener('click', () => {
  state.railOpen = false;
  applyPanels();
});
el('btn-toggle-inspector').addEventListener('click', () => {
  state.inspectorOpen = !state.inspectorOpen;
  applyPanels();
});
el('btn-collapse-inspector').addEventListener('click', () => {
  state.inspectorOpen = false;
  applyPanels();
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'l') {
    state.logOpen = !state.logOpen;
    applyPanels();
  }
  if (e.key === 'Escape' && state.modalOpen) {
    el('live-modal').dataset.userMinimized = '1';
    closeLiveModal({ minimize: true });
  }
});

el('live-strip').addEventListener('click', () => {
  delete el('live-modal').dataset.userMinimized;
  openLiveModal();
});
el('btn-live-minimize').addEventListener('click', () => {
  el('live-modal').dataset.userMinimized = '1';
  closeLiveModal({ minimize: true });
});
el('live-modal-backdrop').addEventListener('click', () => {
  el('live-modal').dataset.userMinimized = '1';
  closeLiveModal({ minimize: true });
});
el('btn-live-stop').addEventListener('click', async () => {
  appendLog('warn', 'Stopping…');
  updateStatus(await api(`${API}/stop`, { method: 'POST', body: '{}' }));
});

window.addEventListener('resize', fitTerm);

el('tab-cases').addEventListener('click', () => setLeftTab('cases'));
el('tab-runs').addEventListener('click', () => {
  setLeftTab('runs');
  loadRuns().catch((err) => appendLog('fail', String(err.message || err)));
});
el('btn-refresh-runs').addEventListener('click', () => {
  loadRuns().catch((err) => appendLog('fail', String(err.message || err)));
});

el('result-filter').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  state.resultFilter = btn.dataset.filter;
  for (const b of el('result-filter').querySelectorAll('.seg-btn')) {
    b.classList.toggle('is-active', b === btn);
  }
  renderResults();
});

el('btn-toggle-provider').addEventListener('click', () => {
  el('provider-drawer').hidden = !el('provider-drawer').hidden;
});

el('btn-start').addEventListener('click', () => startRun({}));
el('btn-stop').addEventListener('click', async () => {
  appendLog('warn', 'Stopping…');
  updateStatus(await api(`${API}/stop`, { method: 'POST', body: '{}' }));
});
el('btn-run-selected').addEventListener('click', () => {
  const ids = [...state.selected];
  if (!ids.length) {
    appendLog('warn', 'No cases checked — running filtered suite.');
    startRun({});
    return;
  }
  startRun({ ids, suite: 'all' });
});
el('btn-run-one').addEventListener('click', () => {
  if (state.activeId) rerunCase(state.activeId);
});
el('btn-select-all').addEventListener('click', () => {
  for (const c of state.cases) state.selected.add(c.id);
  renderCases();
});
el('btn-select-none').addEventListener('click', () => {
  state.selected.clear();
  renderCases();
});
el('btn-clear-log').addEventListener('click', () => clearLog());
el('f-suite').addEventListener('change', loadCases);
el('f-difficulty').addEventListener('change', loadCases);
el('f-search').addEventListener('input', () => {
  if (state.leftTab === 'cases') renderCases();
  else renderRuns();
});

el('cfg-provider').addEventListener('change', () => {
  const presets = { ollama: 'http://127.0.0.1:11434/v1', openai: 'https://api.openai.com/v1' };
  const p = el('cfg-provider').value;
  if (presets[p] && !el('cfg-base-url').value) el('cfg-base-url').value = presets[p];
});

el('btn-save-config').addEventListener('click', async () => {
  try {
    const saved = await api(`${API}/config`, {
      method: 'POST',
      body: JSON.stringify({
        provider: el('cfg-provider').value,
        baseUrl: el('cfg-base-url').value,
        model: el('cfg-model').value,
        apiKey: el('cfg-api-key').value,
        clearApiKey: el('cfg-clear-key').checked,
        timeoutMs: el('cfg-timeout').value,
      }),
    });
    state.config = saved;
    el('cfg-api-key').value = '';
    el('cfg-clear-key').checked = false;
    el('cfg-status').textContent = 'Saved.';
    appendLog('pass', `Provider saved: ${saved.provider || '(unset)'} / ${saved.model || '(unset)'}`);
    await loadConfig();
  } catch (err) {
    appendLog('fail', String(err.message || err));
  }
});

el('btn-reset-fixtures').addEventListener('click', async () => {
  if (!confirm('Reset fixtures?\n\nWipes artifacts and reinstalls every fixture in one step.')) return;
  try {
    state.logOpen = true;
    applyPanels();
    appendLog('info', 'Starting fixture reset (wipe + install)…');
    updateStatus(await api(`${API}/fixtures/reset`, { method: 'POST', body: '{}' }));
  } catch (err) {
    appendLog('fail', String(err.message || err));
  }
});

const es = new EventSource(`${API}/events`);
es.onmessage = (ev) => {
  let data;
  try {
    data = JSON.parse(ev.data);
  } catch {
    return;
  }
  if (data.type === 'hello') {
    if (Array.isArray(data.logs)) replayLogs(data.logs);
    if (data.status) updateStatus(data.status);
    return;
  }
  if (data.type === 'heartbeat' && data.status) updateStatus(data.status);
  if (data.type === 'log') appendLog(data.level || 'info', data.message, { at: data.at });
  if (data.type === 'case_started') {
    state.currentPrompt = data.prompt || '';
    if (data.status) updateStatus(data.status);
    if (data.caseId) {
      const existing = state.resultRows.find((r) => r.id === data.caseId);
      if (!existing) {
        state.resultRows.unshift({
          id: data.caseId,
          running: true,
          suite: data.suite,
          difficulty: data.difficulty,
          fixture: data.fixture,
          prompt: data.prompt,
        });
      }
      renderResults();
    }
  }
  if (data.type === 'case_stage' && data.status) updateStatus(data.status);
  if (data.type === 'case_finished' && data.result) {
    state.resultsById.set(data.result.id, data.result);
    const idx = state.resultRows.findIndex((r) => r.id === data.result.id);
    if (idx >= 0) state.resultRows[idx] = { ...state.resultRows[idx], ...data.result, running: false };
    else state.resultRows.push(data.result);
    if (data.status) updateStatus(data.status);
    else renderResults();
  }
  if (data.type === 'run_finished' || data.type === 'run_stopped' || data.type === 'run_error') {
    if (data.status) updateStatus(data.status);
    if (data.signal) {
      setKpis({
        signal: data.signal,
        passed: state.status.passed,
        failed: state.status.failed,
        score: state.status.total ? state.status.passed / state.status.total : null,
        completed: state.status.completed,
        total: state.status.total,
      });
    }
    if (data.viewerUrl) {
      el('link-run-viewer').hidden = false;
      el('link-run-viewer').href = data.viewerUrl;
    }
    // Keep modal open briefly with finished state, then allow inspect.
    updateLiveModal();
    if (data.status?.runId) {
      state.activeRunId = data.status.runId;
      loadRunResults(data.status.runId).catch(() => {});
    }
  }
  if (data.type === 'fixtures_reset_finished' && data.status) updateStatus(data.status);
};
es.onerror = () => appendLog('warn', 'SSE disconnected — retrying…');

(async function boot() {
  loadPanelPrefs();
  applyPanels();

  // Restore local activity if server buffer is empty (page refresh mid/after idle).
  try {
    const cached = JSON.parse(sessionStorage.getItem(LS_LOGS) || '[]');
    if (cached.length) replayLogs(cached);
  } catch {
    /* ignore */
  }

  state.meta = await api(`${API}/meta`);
  const suiteSel = el('f-suite');
  suiteSel.innerHTML = '<option value="all">all</option>';
  for (const s of state.meta.suites) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.id + (s.expectedCounts?.total ? ` (${s.expectedCounts.total})` : '');
    suiteSel.appendChild(opt);
  }
  await loadConfig();

  // Explicit logs snapshot so refresh always restores server-side activity.
  try {
    const snap = await api(`${API}/logs`);
    if (Array.isArray(snap.logs) && snap.logs.length) replayLogs(snap.logs);
    if (snap.status) updateStatus(snap.status);
  } catch {
    updateStatus(await api(`${API}/status`));
  }

  await loadCases();
  await loadRuns();
  setLeftTab('runs');
  appendLog('info', 'Ready. Live runs open a full console. Panels are collapsible. Press L for activity.');
  if (!busy() && state.runs.length) await loadRunResults(state.runs[0].runId);
})().catch((err) => appendLog('fail', String(err.message || err)));
