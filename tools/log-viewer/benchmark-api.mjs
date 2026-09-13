/**
 * Benchmark runner control plane for the log-viewer tool.
 * Imports harness modules from tests/benchmark — UI stays out of that package.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const mitiiRoot = resolve(toolsDir, '../..');
export const DEFAULT_BENCHMARK_ROOT = resolve(mitiiRoot, 'tests/benchmark');

const PROVIDER_ENV_KEYS = [
  'MITII_PROVIDER',
  'MITII_BASE_URL',
  'MITII_MODEL',
  'MITII_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
];

async function loadHarness(benchmarkRoot) {
  const root = resolve(benchmarkRoot || DEFAULT_BENCHMARK_ROOT);
  const src = join(root, 'src');
  const [
    { loadCases, listSuites, loadSuiteManifest, filterCases },
    { validateSuite },
    { runCases },
    { createRunReporter },
    { listRunSummaries },
  ] = await Promise.all([
    import(join(src, 'cases.mjs')),
    import(join(src, 'validate.mjs')),
    import(join(src, 'runner.mjs')),
    import(join(src, 'report.mjs')),
    import(join(src, 'html-report.mjs')),
  ]);
  return {
    root,
    loadCases,
    listSuites,
    loadSuiteManifest,
    filterCases,
    validateSuite,
    runCases,
    createRunReporter,
    listRunSummaries,
  };
}

export function createBenchmarkApi(options = {}) {
  const reportRootOverride = options.reportRoot
    ? resolve(options.reportRoot)
    : null;
  /** @type {Awaited<ReturnType<typeof loadHarness>> | null} */
  let harness = null;
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  const active = {
    status: 'idle',
    runId: null,
    suite: null,
    total: 0,
    completed: 0,
    passed: 0,
    failed: 0,
    currentCaseId: null,
    currentCaseIndex: null,
    currentStage: null,
    currentStageDetail: null,
    caseStartedAt: null,
    startedAt: null,
    controller: null,
    results: [],
    fixturesResetting: false,
    heartbeatTimer: null,
  };
  const logBuffer = [];
  const MAX_LOG = 4000;

  const state = {
    get rootDir() {
      return harness?.root ?? DEFAULT_BENCHMARK_ROOT;
    },
    get reportRoot() {
      return reportRootOverride ?? join(state.rootDir, 'reports');
    },
    clients,
    active,
    logBuffer,
    broadcast(event) {
      const line = `data: ${JSON.stringify(event)}\n\n`;
      for (const client of clients) {
        try {
          client.write(line);
        } catch {
          clients.delete(client);
        }
      }
    },
    pushLog(level, message, extra = {}) {
      const entry = {
        type: 'log',
        at: new Date().toISOString(),
        level,
        message,
        ...extra,
      };
      logBuffer.push(entry);
      if (logBuffer.length > MAX_LOG) logBuffer.splice(0, logBuffer.length - MAX_LOG);
      state.broadcast(entry);
    },
  };

  async function ensureHarness() {
    if (!harness) {
      harness = await loadHarness(options.benchmarkRoot ?? DEFAULT_BENCHMARK_ROOT);
    }
    return harness;
  }

  /**
   * @returns {Promise<boolean>} true if handled
   */
  async function handle(req, res, url) {
    const { pathname } = url;
    if (!pathname.startsWith('/api/benchmark') && !pathname.startsWith('/benchmark-reports/')) {
      return false;
    }

    await ensureHarness();

    if (req.method === 'GET' && pathname.startsWith('/benchmark-reports/')) {
      return serveReportFile(res, state.reportRoot, pathname.slice('/benchmark-reports/'.length));
    }

    if (req.method === 'GET' && pathname === '/api/benchmark/status') {
      json(res, 200, snapshotStatus(state));
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/benchmark/meta') {
      json(res, 200, buildMeta(harness, state));
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/benchmark/config') {
      json(res, 200, readProviderConfig(harness.root));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/benchmark/config') {
      const body = await readJson(req);
      const saved = writeProviderConfig(harness.root, body ?? {});
      state.pushLog(
        'info',
        `Provider config saved (${saved.provider || 'unset'} / ${saved.model || 'unset'})`,
      );
      json(res, 200, saved);
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/benchmark/fixtures/reset') {
      if (state.active.status === 'running' || state.active.status === 'stopping') {
        throw new Error('Stop the benchmark run before resetting fixtures.');
      }
      if (state.active.fixturesResetting) {
        throw new Error('Fixture reset already in progress.');
      }
      const body = await readJson(req);
      void resetFixtures(state, harness.root, { cleanReports: Boolean(body?.cleanReports) });
      json(res, 200, snapshotStatus(state));
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/benchmark/cases') {
      const suite = url.searchParams.get('suite') ?? 'all';
      const difficulty = url.searchParams.get('difficulty') || undefined;
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      let cases = harness.loadCases(harness.root, { suite });
      cases = harness.filterCases(cases, {
        difficulty,
        category: url.searchParams.get('category') || undefined,
        id: url.searchParams.get('id') || undefined,
      });
      if (q) {
        cases = cases.filter(
          (c) =>
            c.id.toLowerCase().includes(q) ||
            c.prompt.toLowerCase().includes(q) ||
            (c.fixture ?? '').toLowerCase().includes(q) ||
            (c.category ?? '').toLowerCase().includes(q),
        );
      }
      json(res, 200, {
        total: cases.length,
        cases: cases.map((c) => ({
          id: c.id,
          suite: c.suite,
          category: c.category,
          difficulty: c.difficulty,
          mode: c.mode,
          capability: c.capability,
          fixture: c.fixture,
          prompt: c.prompt,
          timeoutMs: c.timeoutMs ?? null,
        })),
      });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/benchmark/runs') {
      const runsDir = join(state.reportRoot, 'runs');
      const runs = harness.listRunSummaries(runsDir).map((run) => ({
        ...run,
        viewerUrl: `/benchmark-reports/runs/${encodeURIComponent(run.runId)}/summary.html`,
        summaryUrl: `/benchmark-reports/runs/${encodeURIComponent(run.runId)}/summary.md`,
      }));
      json(res, 200, {
        runs,
        indexUrl: existsSync(join(state.reportRoot, 'index.html'))
          ? '/benchmark-reports/index.html'
          : null,
        reportRoot: state.reportRoot,
      });
      return true;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/benchmark/runs/')) {
      const parts = pathname.split('/').filter(Boolean);
      const runId = parts[3];
      if (!runId) {
        json(res, 404, { error: 'missing run id' });
        return true;
      }
      const runDir = join(state.reportRoot, 'runs', runId);
      if (!existsSync(runDir)) {
        json(res, 404, { error: 'run not found' });
        return true;
      }
      if (parts[4] === 'cases' && parts[5]) {
        const caseId = parts[5];
        const md = join(runDir, 'cases', `${caseId}.md`);
        const js = join(runDir, 'cases', `${caseId}.json`);
        if (!existsSync(js)) {
          json(res, 404, { error: 'case report not found' });
          return true;
        }
        const result = JSON.parse(readFileSync(js, 'utf8'));
        json(res, 200, {
          markdown: existsSync(md) ? readFileSync(md, 'utf8') : null,
          result,
        });
        return true;
      }
      const summaryPath = join(runDir, 'summary.json');
      if (!existsSync(summaryPath)) {
        json(res, 404, { error: 'summary not found' });
        return true;
      }
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
      const failedIds = Array.isArray(summary.results)
        ? summary.results.filter((r) => r && r.passed === false).map((r) => r.id)
        : [];
      json(res, 200, {
        ...summary,
        failedIds,
        viewerUrl: `/benchmark-reports/runs/${encodeURIComponent(runId)}/summary.html`,
      });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/benchmark/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Send status + log snapshot in one hello so refresh can restore the feed.
      res.write(
        `data: ${JSON.stringify({
          type: 'hello',
          status: snapshotStatus(state),
          logs: state.logBuffer.slice(-500),
        })}\n\n`,
      );
      state.clients.add(res);
      req.on('close', () => state.clients.delete(res));
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/benchmark/logs') {
      json(res, 200, {
        logs: state.logBuffer.slice(-500),
        status: snapshotStatus(state),
      });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/benchmark/run') {
      const body = await readJson(req);
      await startRun(state, harness, body ?? {});
      json(res, 200, snapshotStatus(state));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/benchmark/stop') {
      stopRun(state);
      json(res, 200, snapshotStatus(state));
      return true;
    }

    json(res, 404, { error: 'not found' });
    return true;
  }

  return { handle, state, ensureHarness };
}

function buildMeta(harness, state) {
  const suites = harness.listSuites(harness.root).map((id) => {
    const manifest = harness.loadSuiteManifest(harness.root, id);
    return {
      id,
      name: manifest?.name ?? id,
      expectedCounts: manifest?.expectedCounts ?? null,
      gates: manifest?.gates ?? null,
    };
  });
  const all = harness.loadCases(harness.root, { suite: 'all' });
  const runsDir = join(state.reportRoot, 'runs');
  return {
    suites,
    totalCases: all.length,
    difficulties: ['easy', 'medium', 'hard'],
    capabilities: [...new Set(all.map((c) => c.capability).filter(Boolean))].sort(),
    categories: [...new Set(all.map((c) => c.category).filter(Boolean))].sort(),
    benchmarkRoot: harness.root,
    reportRoot: state.reportRoot,
    pastRunCount: existsSync(runsDir) ? harness.listRunSummaries(runsDir).length : 0,
    providers: [
      { id: 'ollama', label: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434/v1' },
      { id: 'openai-compatible', label: 'OpenAI-compatible', defaultBaseUrl: '' },
      { id: 'anthropic', label: 'Anthropic', defaultBaseUrl: '' },
      { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
      { id: 'gemini', label: 'Gemini', defaultBaseUrl: '' },
    ],
  };
}

function snapshotStatus(state) {
  const a = state.active;
  return {
    status: a.fixturesResetting ? 'resetting' : a.status,
    runId: a.runId,
    suite: a.suite,
    total: a.total,
    completed: a.completed,
    passed: a.passed,
    failed: a.failed,
    currentCaseId: a.currentCaseId,
    currentCaseIndex: a.currentCaseIndex,
    currentStage: a.currentStage,
    currentStageDetail: a.currentStageDetail,
    caseStartedAt: a.caseStartedAt,
    startedAt: a.startedAt,
    fixturesResetting: a.fixturesResetting,
    elapsedMs: a.startedAt ? Date.now() - new Date(a.startedAt).getTime() : 0,
    caseElapsedMs: a.caseStartedAt ? Date.now() - new Date(a.caseStartedAt).getTime() : 0,
    results: a.results.slice(-80).map((r) => ({
      id: r.id,
      passed: r.passed,
      difficulty: r.difficulty,
      suite: r.suite,
      durationMs: r.durationMs,
      error: r.error,
      exitCode: r.exitCode,
    })),
  };
}

function clearHeartbeat(state) {
  if (state.active.heartbeatTimer) {
    clearInterval(state.active.heartbeatTimer);
    state.active.heartbeatTimer = null;
  }
}

function startHeartbeat(state) {
  clearHeartbeat(state);
  let ticks = 0;
  state.active.heartbeatTimer = setInterval(() => {
    if (state.active.status !== 'running' && state.active.status !== 'stopping') {
      clearHeartbeat(state);
      return;
    }
    ticks += 1;
    const status = snapshotStatus(state);
    state.broadcast({ type: 'heartbeat', status });
    // Every ~30s while the agent is silent, emit a visible activity line.
    if (
      status.currentCaseId &&
      status.currentStage === 'agent' &&
      status.caseElapsedMs > 15000 &&
      ticks % 6 === 0
    ) {
      const secs = Math.round(status.caseElapsedMs / 1000);
      state.pushLog(
        'info',
        `… still running ${status.currentCaseId} · agent thinking · ${secs}s elapsed`,
        { caseId: status.currentCaseId, heartbeat: true },
      );
    }
  }, 5000);
}

function isSecretKey(key) {
  return /api[_-]?key|token|secret|password/i.test(key);
}

function maskSecret(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 8) return '••••••••';
  return `${text.slice(0, 3)}…${text.slice(-2)} (${text.length} chars)`;
}

function readProviderConfig(rootDir) {
  const configPath = resolveConfigPath(rootDir);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const fileEnv = { ...(config.agent?.env ?? {}) };
  const processEnv = {};
  for (const key of PROVIDER_ENV_KEYS) {
    if (process.env[key]) processEnv[key] = process.env[key];
  }

  const effective = { ...processEnv, ...fileEnv };
  const secrets = {};
  for (const [key, value] of Object.entries(effective)) {
    if (isSecretKey(key) && value) {
      secrets[key] = {
        set: true,
        masked: maskSecret(value),
        source: fileEnv[key] ? 'config' : 'process',
      };
    }
  }

  return {
    configPath,
    provider: effective.MITII_PROVIDER || '',
    baseUrl: effective.MITII_BASE_URL || '',
    model: effective.MITII_MODEL || '',
    timeoutMs: config.agent?.timeoutMs ?? null,
    apiKeySet: Boolean(
      effective.MITII_API_KEY ||
        effective.ANTHROPIC_API_KEY ||
        effective.OPENAI_API_KEY ||
        effective.GEMINI_API_KEY,
    ),
    secrets,
    fileEnv: Object.fromEntries(
      Object.entries(fileEnv).map(([k, v]) => [k, isSecretKey(k) ? maskSecret(v) : v]),
    ),
    processOverrides: Object.keys(processEnv),
  };
}

function writeProviderConfig(rootDir, body) {
  const configPath = resolveConfigPath(rootDir);
  if (configPath.endsWith('.example.json')) {
    throw new Error('Copy benchmark.config.example.json to benchmark.config.json first.');
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!config.agent) config.agent = {};
  if (!config.agent.env || typeof config.agent.env !== 'object') config.agent.env = {};

  const env = { ...config.agent.env };
  const setOrClear = (key, value) => {
    if (value === undefined) return;
    const trimmed = String(value ?? '').trim();
    if (!trimmed) delete env[key];
    else env[key] = trimmed;
  };

  setOrClear('MITII_PROVIDER', body.provider);
  setOrClear('MITII_BASE_URL', body.baseUrl);
  setOrClear('MITII_MODEL', body.model);

  if (typeof body.apiKey === 'string' && body.apiKey.trim() && !body.apiKey.includes('…')) {
    env.MITII_API_KEY = body.apiKey.trim();
  } else if (body.clearApiKey) {
    delete env.MITII_API_KEY;
  }

  if (body.timeoutMs != null && body.timeoutMs !== '') {
    const n = Number(body.timeoutMs);
    if (!Number.isFinite(n) || n < 1000) throw new Error('timeoutMs must be >= 1000');
    config.agent.timeoutMs = Math.round(n);
  }

  config.agent.env = env;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return readProviderConfig(rootDir);
}

async function resetFixtures(state, rootDir, { cleanReports = false } = {}) {
  state.active.fixturesResetting = true;
  state.broadcast({ type: 'fixtures_reset_started', status: snapshotStatus(state) });
  state.pushLog('info', 'Resetting fixtures (wipe artifacts + reinstall)…');

  const script = join(rootDir, 'scripts/reset-fixtures.mjs');
  const args = [script];
  if (cleanReports) args.push('--reports');

  await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onChunk = (level) => (buf) => {
      const text = String(buf);
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) state.pushLog(level, line);
      }
    };
    child.stdout?.on('data', onChunk('info'));
    child.stderr?.on('data', onChunk('warn'));
    child.on('close', (code) => {
      state.active.fixturesResetting = false;
      if (code === 0) {
        state.pushLog('pass', 'Fixture reset complete (cleaned + reinstalled).');
        state.broadcast({ type: 'fixtures_reset_finished', ok: true, status: snapshotStatus(state) });
      } else {
        state.pushLog('fail', `Fixture reset failed (exit ${code}).`);
        state.broadcast({
          type: 'fixtures_reset_finished',
          ok: false,
          exitCode: code,
          status: snapshotStatus(state),
        });
      }
      resolvePromise();
    });
    child.on('error', (error) => {
      state.active.fixturesResetting = false;
      state.pushLog('fail', `Fixture reset error: ${error.message}`);
      state.broadcast({
        type: 'fixtures_reset_finished',
        ok: false,
        error: error.message,
        status: snapshotStatus(state),
      });
      resolvePromise();
    });
  });
}

function serveReportFile(res, reportRoot, relativePath) {
  const decoded = decodeURIComponent(relativePath);
  const full = resolve(reportRoot, decoded);
  const rootResolved = resolve(reportRoot);
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) {
    json(res, 403, { error: 'forbidden' });
    return true;
  }
  if (!existsSync(full)) {
    json(res, 404, { error: 'not found' });
    return true;
  }
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  };
  const ext = full.includes('.') ? full.slice(full.lastIndexOf('.')) : '';
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(readFileSync(full));
  return true;
}

async function startRun(state, harness, body) {
  if (state.active.fixturesResetting) {
    throw new Error('Fixture reset in progress. Wait for it to finish.');
  }
  if (state.active.status === 'running' || state.active.status === 'stopping') {
    throw new Error('A run is already in progress. Stop it first.');
  }

  const suite = body.suite ?? 'all';
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  const difficulty = body.difficulty || undefined;
  const category = body.category || undefined;
  const concurrency = Math.max(1, Number(body.concurrency ?? 1));
  const keepWorkspaces = Boolean(body.keepWorkspaces);

  const configPath = resolveConfigPath(harness.root);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  let selected = harness.loadCases(harness.root, { suite });
  if (ids.length > 0) {
    const idSet = new Set(ids);
    selected = selected.filter((c) => idSet.has(c.id));
  } else {
    selected = harness.filterCases(selected, { difficulty, category });
  }
  if (selected.length === 0) {
    throw new Error('No cases matched the selection.');
  }

  if (ids.length === 0) {
    const validation = harness.validateSuite(
      harness.loadCases(harness.root, { suite }),
      harness.root,
      { suite },
    );
    if (!validation.valid && suite !== 'all') {
      state.pushLog('warn', `Suite validation warnings: ${validation.errors.slice(0, 3).join('; ')}`);
    }
  }

  const controller = new AbortController();
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const runDir = join(state.reportRoot, 'runs', runId);
  const latestPath = join(
    state.reportRoot,
    suite === 'all' ? 'ui-latest.json' : `ui-${suite}-latest.json`,
  );

  let expectedByDifficulty = null;
  let expectedTotal = selected.length;
  if (suite !== 'all' && ids.length === 0) {
    const manifest = harness.loadSuiteManifest(harness.root, suite);
    config.gates = { ...config.gates, ...(manifest.gates ?? {}) };
    expectedByDifficulty = {
      easy: manifest.expectedCounts?.easy ?? 0,
      medium: manifest.expectedCounts?.medium ?? 0,
      hard: manifest.expectedCounts?.hard ?? 0,
    };
    expectedTotal = manifest.expectedCounts?.total ?? selected.length;
  }

  const reporter = harness.createRunReporter({
    runId,
    runDir,
    startedAt,
    config,
    suite,
    latestPath,
    expectedByDifficulty,
    expectedTotal,
  });

  Object.assign(state.active, {
    status: 'running',
    runId,
    suite,
    total: selected.length,
    completed: 0,
    passed: 0,
    failed: 0,
    currentCaseId: null,
    currentCaseIndex: null,
    currentStage: 'queued',
    currentStageDetail: `${selected.length} case(s) queued`,
    caseStartedAt: null,
    startedAt: startedAt.toISOString(),
    controller,
    results: [],
  });
  state.logBuffer.length = 0;
  const provider =
    config.agent?.env?.MITII_PROVIDER || process.env.MITII_PROVIDER || '(default setup)';
  const model = config.agent?.env?.MITII_MODEL || process.env.MITII_MODEL || '(default)';
  state.pushLog(
    'info',
    `▶ Starting run ${runId}`,
  );
  state.pushLog(
    'info',
    `  ${selected.length} case(s) · suite=${suite} · provider=${provider} · model=${model}`,
  );
  for (const [i, c] of selected.slice(0, 12).entries()) {
    state.pushLog('info', `  queue[${i + 1}] ${c.id}`);
  }
  if (selected.length > 12) {
    state.pushLog('info', `  …and ${selected.length - 12} more`);
  }
  state.broadcast({ type: 'run_started', status: snapshotStatus(state) });
  startHeartbeat(state);

  void (async () => {
    try {
      const results = await harness.runCases(selected, harness.root, config, {
        configPath,
        concurrency,
        keepWorkspaces,
        signal: controller.signal,
        onCaseStart(testCase, index, total) {
          state.active.currentCaseId = testCase.id;
          state.active.currentCaseIndex = index;
          state.active.currentStage = 'prepare';
          state.active.currentStageDetail = 'Preparing workspace';
          state.active.caseStartedAt = new Date().toISOString();
          state.pushLog(
            'info',
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          );
          state.pushLog(
            'info',
            `[${index + 1}/${total}] START ${testCase.suite}/${testCase.difficulty} ${testCase.id}`,
            { caseId: testCase.id },
          );
          state.pushLog('info', `  fixture=${testCase.fixture} · mode=${testCase.mode}`, {
            caseId: testCase.id,
          });
          state.broadcast({
            type: 'case_started',
            caseId: testCase.id,
            index,
            total,
            prompt: testCase.prompt,
            fixture: testCase.fixture,
            difficulty: testCase.difficulty,
            suite: testCase.suite,
            status: snapshotStatus(state),
          });
        },
        onCaseStage(testCase, stage, detail, index, total) {
          state.active.currentCaseId = testCase.id;
          state.active.currentCaseIndex = index;
          state.active.currentStage = stage;
          state.active.currentStageDetail = detail || stage;
          state.pushLog('info', `  ▸ ${stage}${detail ? `: ${detail}` : ''}`, {
            caseId: testCase.id,
            stage,
          });
          state.broadcast({
            type: 'case_stage',
            caseId: testCase.id,
            stage,
            detail,
            index,
            total,
            status: snapshotStatus(state),
          });
        },
        onCaseStdout(testCase, chunk) {
          const text = String(chunk);
          // Surface structured adapter/CLI events as readable activity lines.
          for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('{')) {
              try {
                const evt = JSON.parse(trimmed);
                const kind = evt.type || evt.event || evt.stage || 'event';
                if (kind === 'stage_started' || kind === 'stage_completed') {
                  state.pushLog(
                    'stream',
                    `  agent ${kind}: ${evt.stage || ''}${evt.exitCode != null ? ` (exit ${evt.exitCode})` : ''}`,
                    { caseId: testCase.id },
                  );
                } else if (kind === 'end') {
                  state.pushLog(
                    evt.ok === false ? 'warn' : 'stream',
                    `  agent end: ok=${evt.ok} status=${evt.status || evt.reason || ''}`,
                    { caseId: testCase.id },
                  );
                } else if (kind === 'tool_call' || kind === 'tool_result' || kind === 'model_turn') {
                  state.pushLog('stream', `  agent ${kind}${evt.name ? `: ${evt.name}` : ''}`, {
                    caseId: testCase.id,
                  });
                }
              } catch {
                // ignore non-json
              }
            }
          }
          state.broadcast({
            type: 'case_stdout',
            caseId: testCase.id,
            chunk: text.slice(0, 4000),
          });
        },
        onCaseStderr(testCase, chunk) {
          const text = String(chunk);
          for (const line of text.split(/\r?\n/)) {
            if (line.trim()) {
              state.pushLog('warn', `  ! ${line.trim().slice(0, 300)}`, { caseId: testCase.id });
            }
          }
          state.broadcast({
            type: 'case_stderr',
            caseId: testCase.id,
            chunk: text.slice(0, 2000),
          });
        },
        onResult(result, index, total) {
          reporter.record(result, index, total);
          state.active.completed += 1;
          if (result.passed) state.active.passed += 1;
          else state.active.failed += 1;
          state.active.results.push(result);
          state.active.currentStage = result.passed ? 'passed' : 'failed';
          state.active.currentStageDetail = result.passed ? 'Passed' : result.error || 'Failed';
          const status = result.passed ? 'PASS' : 'FAIL';
          state.pushLog(
            result.passed ? 'pass' : 'fail',
            `[${index + 1}/${total}] ${status} ${result.id} (${result.durationMs}ms)${result.error ? ` — ${result.error}` : ''}`,
            { caseId: result.id, passed: result.passed },
          );
          state.broadcast({
            type: 'case_finished',
            result: {
              id: result.id,
              passed: result.passed,
              durationMs: result.durationMs,
              error: result.error,
              exitCode: result.exitCode,
              difficulty: result.difficulty,
              suite: result.suite,
              prompt: result.prompt,
              fixture: result.fixture,
            },
            status: snapshotStatus(state),
          });
        },
      });

      const { report, summaryPaths } = reporter.finalize(results);
      const stopped = controller.signal.aborted;
      clearHeartbeat(state);
      state.active.status = 'idle';
      state.active.currentCaseId = null;
      state.active.currentCaseIndex = null;
      state.active.currentStage = null;
      state.active.currentStageDetail = null;
      state.active.caseStartedAt = null;
      state.active.controller = null;
      state.pushLog(
        'info',
        stopped
          ? `■ Stopped. Signal=${report.signal}. Summary: ${summaryPaths.markdown}`
          : `■ Finished. Signal=${report.signal}. Summary: ${summaryPaths.markdown}`,
      );
      state.broadcast({
        type: stopped ? 'run_stopped' : 'run_finished',
        signal: report.signal,
        status: snapshotStatus(state),
        summaryPath: summaryPaths.markdown,
        htmlPath: summaryPaths.html,
        viewerUrl: `/benchmark-reports/runs/${encodeURIComponent(runId)}/summary.html`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      clearHeartbeat(state);
      state.active.status = 'idle';
      state.active.controller = null;
      state.active.currentCaseId = null;
      state.active.currentStage = null;
      state.active.currentStageDetail = null;
      state.active.caseStartedAt = null;
      state.pushLog('fail', `Run crashed: ${message}`);
      state.broadcast({ type: 'run_error', error: message, status: snapshotStatus(state) });
    }
  })();
}

function stopRun(state) {
  if (state.active.status !== 'running' || !state.active.controller) {
    return;
  }
  state.active.status = 'stopping';
  state.pushLog('warn', 'Stop requested — aborting in-flight agent…');
  state.active.controller.abort();
  state.broadcast({ type: 'run_stopping', status: snapshotStatus(state) });
}

function resolveConfigPath(rootDir) {
  const local = join(rootDir, 'benchmark.config.json');
  const example = join(rootDir, 'benchmark.config.example.json');
  if (existsSync(local)) return local;
  if (existsSync(example)) return example;
  throw new Error(`Missing benchmark.config.json under ${rootDir}`);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}
