#!/usr/bin/env node
/**
 * Runner for the hand-written manual benchmark suite (tools/benchmark/tasks/manual/**).
 * Modeled on run-eval.mjs (concurrency pool, per-task timeout, JSON+MD report) with two
 * differences: tasks are discovered by glob (no index.json to hand-maintain), and every
 * task always runs with --json so a `metrics` event (durationMs, toolCalls, sessionLogPath)
 * and the session log's token_usage events are available for every mode, including ask.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { verifyTask, summarizeVerifications } from '../verify.mjs';

const benchmarkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(benchmarkDir, '../..');
const manualTasksDir = join(benchmarkDir, 'tasks/manual');
const fixtureRoot = join(benchmarkDir, 'fixtures');
const resultsDir = join(benchmarkDir, 'results/manual');

// Fixtures are plain subdirectories of this repo (no nested .git), so their tracked files
// live in the outer repo's git index. Without a reset, a task's edits (e.g. fixing orders.js)
// leak into the next task that reuses the same fixture, corrupting "don't touch X" style
// verify checks with state from a prior run. Reset scoped to just that fixture before each task.
function resetFixture(fixtureName) {
  const fixturePath = `tools/benchmark/fixtures/${fixtureName}/`;
  spawnSync('git', ['checkout', '--', fixturePath], { cwd: packageRoot, stdio: 'ignore' });
  spawnSync('git', ['clean', '-fd', fixturePath], { cwd: packageRoot, stdio: 'ignore' });
}

// Serializes reset+run+verify per fixture so concurrent tasks sharing a fixture can't reset
// out from under one another; tasks on different fixtures still run fully in parallel.
const fixtureLocks = new Map();
function withFixtureLock(fixtureName, fn) {
  if (!fixtureName) return fn();
  const previous = fixtureLocks.get(fixtureName) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  fixtureLocks.set(fixtureName, next.catch(() => {}));
  return next;
}

const args = process.argv.slice(2);
const provider = valueOf(args, '--provider') ?? 'echo';
const runtime = valueOf(args, '--runtime') ?? (provider === 'echo' ? 'stub' : 'real');
const approval = valueOf(args, '--approval') ?? 'auto';
const baseUrl = valueOf(args, '--base-url');
const model = valueOf(args, '--model');
const apiKey = valueOf(args, '--api-key');
const concurrency = Math.max(1, Number(valueOf(args, '--concurrency') ?? '1'));
const limit = valueOf(args, '--limit') ? Number(valueOf(args, '--limit')) : undefined;
const timeoutMs = Number(valueOf(args, '--timeout-ms') ?? '120000');
const modeFilter = valueOf(args, '--mode'); // ask|plan|agent
const severityFilter = valueOf(args, '--severity'); // easy|medium|hard
const tagFilter = valueOf(args, '--tag');
const idFilter = valueOf(args, '--id'); // substring match
const fixtureFilter = valueOf(args, '--fixture');
const enablePuppeteer = args.includes('--enable-puppeteer');
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose') || args.includes('-v');
const skipValidate = args.includes('--no-validate');

if (!skipValidate) {
  const validation = spawnSync('node', [join(benchmarkDir, 'scripts/validate-manual-tasks.mjs')], {
    cwd: benchmarkDir,
    stdio: 'inherit',
  });
  if (validation.status !== 0) {
    console.error('\nManual task validation failed; fix the errors above before running.');
    process.exit(validation.status ?? 1);
  }
  console.log('');
}

if (!existsSync(join(packageRoot, 'dist/cli.js'))) {
  console.log('▶ Compiling CLI (dist/cli.js not found)...');
  const compile = spawnSync(packageManager(), ['run', 'compile:cli'], {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (compile.status) process.exit(compile.status ?? 1);
}

const cliPath = join(packageRoot, 'dist/cli.js');

let selectedTasks = loadAllTasks(manualTasksDir);
if (modeFilter) selectedTasks = selectedTasks.filter((t) => t.mode === modeFilter);
if (severityFilter) selectedTasks = selectedTasks.filter((t) => t.severity === severityFilter);
if (tagFilter) selectedTasks = selectedTasks.filter((t) => (t.tags ?? []).includes(tagFilter));
if (idFilter) selectedTasks = selectedTasks.filter((t) => t.id.includes(idFilter));
if (fixtureFilter) selectedTasks = selectedTasks.filter((t) => t.fixture === fixtureFilter);
if (limit !== undefined) selectedTasks = selectedTasks.slice(0, limit);

if (!selectedTasks.length) {
  console.error('No manual tasks matched the given filters.');
  process.exit(1);
}

if (dryRun) {
  console.log(`Dry run: ${selectedTasks.length} manual task(s) (concurrency ${concurrency}, runtime ${runtime})`);
  process.exit(0);
}

console.log(
  `\nRunning ${selectedTasks.length} manual benchmark task(s) — provider=${provider}, runtime=${runtime}, concurrency=${concurrency}\n`
);

const startedAt = new Date();
const results = await runPool(selectedTasks, concurrency, startedAt);
const passed = results.filter((r) => r.passed).length;

const report = buildReport(results, startedAt, new Date());
writeReport(report, startedAt, { log: true });
appendHistory(report, startedAt);

console.log(
  `\n${passed}/${results.length} manual tasks passed (${report.summary.score}%) — avg ${report.summary.avgDurationMs}ms, avg ${report.summary.avgTokens} tokens/task`
);
if (passed !== results.length) process.exitCode = 1;

// ---------------------------------------------------------------------------

function loadAllTasks(dir) {
  const files = findTaskFiles(dir);
  const all = [];
  for (const file of files) {
    const tasks = JSON.parse(readFileSync(file, 'utf8'));
    for (const task of tasks) all.push(task);
  }
  return all;
}

function findTaskFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...findTaskFiles(full));
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

async function runPool(tasks, poolSize, startedAt) {
  const results = new Array(tasks.length);
  let next = 0;
  let completed = 0;
  let passedSoFar = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      const result = await runTask(tasks[i], i, tasks.length);
      results[i] = result;
      completed += 1;
      if (result.passed) passedSoFar += 1;
      const status = result.timedOut ? '⏱ TIMEOUT' : result.passed ? '✓ pass' : '✗ FAIL';
      console.log(
        `[${i + 1}/${tasks.length}] ${status} — ${result.id} (${result.durationMs}ms, ${result.tokens.total} tok) — running total: ${passedSoFar}/${completed}`
      );
      if (!result.passed && !verbose) {
        const failedChecks = result.verifications.filter((v) => !v.passed).map((v) => v.rule).filter(Boolean);
        if (failedChecks.length) console.log(`    failed checks: ${failedChecks.join(', ')}`);
        if (result.stderr.trim()) console.log(`    stderr: ${result.stderr.trim().slice(0, 500)}`);
      }

      // Write the report after every task, not just once at the end, so a run that's killed
      // partway through (timeout, ctrl-c, crash) still leaves a report reflecting what ran.
      const completedResults = results.filter(Boolean);
      writeReport(buildReport(completedResults, startedAt, new Date()), startedAt);
    }
  }

  await Promise.all(Array.from({ length: Math.min(poolSize, tasks.length) }, () => worker()));
  return results;
}

function buildReport(results, startedAt, finishedAt) {
  const passed = results.filter((r) => r.passed).length;
  const summary = {
    total: results.length,
    passed,
    failed: results.length - passed,
    score: results.length ? Math.round((passed / results.length) * 100) : 0,
    avgDurationMs: avg(results.map((r) => r.durationMs)),
    totalTokens: sum(results.map((r) => r.tokens.total)),
    avgTokens: avg(results.map((r) => r.tokens.total)),
  };

  return {
    packageRoot,
    provider,
    runtime,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    summary,
    matrix: buildMatrix(results),
    categoryBreakdown: summarizeByKey(results, (r) => r.category),
    verificationSummary: summarizeVerifications(results),
    results,
  };
}

function runTask(task, index, total) {
  return withFixtureLock(task.fixture, () => runTaskOnce(task, index, total));
}

function runTaskOnce(task, index, total) {
  return new Promise((resolvePromise) => {
    if (task.fixture) resetFixture(task.fixture);
    const fixtureCwd = task.fixture ? join(fixtureRoot, task.fixture) : packageRoot;
    const cliArgs = [
      cliPath, task.mode, task.prompt,
      '--cwd', fixtureCwd,
      '--provider', provider,
      '--runtime', task.runtime ?? runtime,
      '--approval', approval,
      '--json', // always JSON so metrics + tokens are capturable for every mode
      '--vectors',
    ];
    if (enablePuppeteer || task.enablePuppeteer) cliArgs.push('--enable-puppeteer');
    if (baseUrl) cliArgs.push('--base-url', baseUrl);
    if (apiKey) cliArgs.push('--api-key', apiKey);
    const taskModel = task.model ?? model;
    if (taskModel) cliArgs.push('--model', taskModel);

    console.log(`[${index + 1}/${total}] ▶ ${task.id} (${task.mode}/${task.severity}${task.fixture ? `, ${task.fixture}` : ''})`);

    const started = Date.now();
    const child = spawn('node', cliArgs, { cwd: packageRoot, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const effectiveTimeout = task.timeoutMs ?? timeoutMs;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, effectiveTimeout);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (verbose) process.stdout.write(`    ${chunk}`);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      if (verbose) process.stderr.write(`    ${chunk}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      const exitCode = timedOut ? 124 : (code ?? 1);
      const verifications = (task.verify ?? []).map((rule) => verifyTask(rule, {
        stdout,
        stderr,
        exitCode,
        cwd: fixtureCwd,
        packageRoot,
        mode: task.mode,
      }));
      const passed = !timedOut && exitCode === 0 && verifications.every((v) => v.passed);

      const { metrics, tokens } = extractMetricsAndTokens(stdout);

      resolvePromise({
        id: task.id,
        mode: task.mode,
        severity: task.severity ?? 'unknown',
        category: task.category ?? 'general',
        tags: task.tags ?? [],
        fixture: task.fixture ?? null,
        passed,
        durationMs,
        exitCode,
        timedOut,
        toolCalls: metrics?.toolCalls ?? 0,
        sessionLogPath: metrics?.sessionLogPath ? relative(packageRoot, metrics.sessionLogPath) : null,
        tokens,
        verifications,
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 2000),
      });
    });
  });
}

function extractMetricsAndTokens(stdout) {
  let metrics;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'metrics') metrics = event;
    } catch {
      // non-JSON line (shouldn't happen with --json, but stay resilient)
    }
  }

  // The headless CLI/SDK path (HeadlessAgentHost) doesn't wire up UsageTrackingProvider's
  // real per-call accounting — that only exists on the VS Code extension's ThunderController
  // path. The only token telemetry available here is ChatOrchestrator's own per-turn estimate
  // (`{ promptAssemblyTokens, retrievedContextTokens, responseEstimateTokens }`), emitted once
  // per LLM turn, so a multi-turn agent run needs these summed across turns, not just the last.
  const tokens = { input: 0, output: 0, total: 0, turns: 0, estimated: true };
  if (metrics?.sessionLogPath && existsSync(metrics.sessionLogPath)) {
    try {
      const logLines = readFileSync(metrics.sessionLogPath, 'utf8').split('\n');
      for (const line of logLines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type !== 'token_usage') continue;
        const data = event.data ?? {};
        if (typeof data.promptAssemblyTokens === 'number') {
          tokens.input += data.promptAssemblyTokens;
          tokens.turns += 1;
        }
        if (typeof data.responseEstimateTokens === 'number') tokens.output += data.responseEstimateTokens;
      }
      tokens.total = tokens.input + tokens.output;
    } catch {
      // best-effort — leave tokens at zero if the log can't be read
    }
  }

  return { metrics, tokens };
}

function buildMatrix(results) {
  const matrix = {};
  for (const r of results) {
    matrix[r.mode] ??= {};
    matrix[r.mode][r.severity] ??= { passed: 0, total: 0 };
    matrix[r.mode][r.severity].total += 1;
    if (r.passed) matrix[r.mode][r.severity].passed += 1;
  }
  for (const mode of Object.keys(matrix)) {
    for (const severity of Object.keys(matrix[mode])) {
      const cell = matrix[mode][severity];
      cell.score = cell.total ? Math.round((cell.passed / cell.total) * 100) : 0;
    }
  }
  return matrix;
}

function summarizeByKey(results, keyFn) {
  const map = {};
  for (const r of results) {
    const key = keyFn(r) ?? 'unknown';
    map[key] ??= { passed: 0, total: 0 };
    map[key].total += 1;
    if (r.passed) map[key].passed += 1;
  }
  for (const key of Object.keys(map)) {
    const { passed, total } = map[key];
    map[key].score = total ? Math.round((passed / total) * 100) : 0;
  }
  return map;
}

// Safe to call repeatedly (e.g. after every task) — always overwrites the same
// report-<timeStamp>.{json,md} and latest.{json,md} files for this run.
function writeReport(report, startedAt, { log = false } = {}) {
  mkdirSync(resultsDir, { recursive: true });

  const dateStamp = startedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStamp = startedAt.toISOString().slice(11, 19).replace(/:/g, ''); // HHMMSS
  const dayDir = join(resultsDir, dateStamp);
  mkdirSync(dayDir, { recursive: true });

  const jsonPath = join(dayDir, `report-${timeStamp}.json`);
  const mdPath = join(dayDir, `report-${timeStamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, toMarkdown(report, dayDir), 'utf8');

  writeFileSync(join(resultsDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(resultsDir, 'latest.md'), toMarkdown(report, resultsDir), 'utf8');

  if (log) {
    console.log(`\nReports written:`);
    console.log(`  ${relative(packageRoot, jsonPath)}`);
    console.log(`  ${relative(packageRoot, mdPath)}`);
    console.log(`  ${relative(packageRoot, join(resultsDir, 'latest.md'))}`);
  }
}

// Appends exactly one row per run — call only once, after the whole run finishes.
function appendHistory(report, startedAt) {
  const dateStamp = startedAt.toISOString().slice(0, 10);
  const timeStamp = startedAt.toISOString().slice(11, 19).replace(/:/g, '');
  const historyPath = join(resultsDir, 'history.md');
  if (!existsSync(historyPath)) {
    writeFileSync(
      historyPath,
      '# Manual Benchmark History\n\n| Date | Provider | Total | Passed | Failed | Score | Avg Tokens | Avg Duration |\n|---|---|---:|---:|---:|---:|---:|---:|\n',
      'utf8'
    );
  }
  appendFileSync(
    historyPath,
    `| ${dateStamp} ${timeStamp} | ${report.provider} | ${report.summary.total} | ${report.summary.passed} | ${report.summary.failed} | ${report.summary.score}% | ${report.summary.avgTokens} | ${report.summary.avgDurationMs}ms |\n`,
    'utf8'
  );
  console.log(`  ${relative(packageRoot, historyPath)} (appended)`);
}

function toMarkdown(report, fromDir) {
  const lines = [
    '# Mitii Manual Benchmark Report',
    '',
    `Provider: ${report.provider}`,
    `Runtime: ${report.runtime}`,
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Score: ${report.summary.passed}/${report.summary.total} (${report.summary.score}%)`,
    `Avg duration: ${report.summary.avgDurationMs} ms`,
    `Avg tokens/task: ${report.summary.avgTokens} (total ${report.summary.totalTokens})`,
    '',
    '## Mode x Severity matrix',
    '',
    '| Mode | Severity | Passed | Total | Score |',
    '|---|---|---:|---:|---:|',
  ];
  for (const mode of Object.keys(report.matrix).sort()) {
    for (const severity of Object.keys(report.matrix[mode]).sort()) {
      const cell = report.matrix[mode][severity];
      lines.push(`| ${mode} | ${severity} | ${cell.passed} | ${cell.total} | ${cell.score}% |`);
    }
  }

  lines.push('', '## Category breakdown', '');
  for (const [cat, v] of Object.entries(report.categoryBreakdown)) {
    lines.push(`- ${cat}: ${v.passed}/${v.total} (${v.score}%)`);
  }

  lines.push(
    '',
    '## Per-test-case results',
    '',
    '| # | Task | Mode | Severity | Category | Result | Duration | Input tok | Output tok | Total tok | Tool calls | Log |',
    '|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---|'
  );
  report.results.forEach((r, index) => {
    const status = r.timedOut ? 'timeout' : r.passed ? 'pass' : 'fail';
    const log = r.sessionLogPath
      ? `[log](${relative(fromDir, join(packageRoot, r.sessionLogPath)).split('\\').join('/')})`
      : '-';
    lines.push(
      `| ${index + 1} | ${r.id} | ${r.mode} | ${r.severity} | ${r.category} | ${status} | ${r.durationMs} ms | ${r.tokens.input} | ${r.tokens.output} | ${r.tokens.total} | ${r.toolCalls} | ${log} |`
    );
  });
  lines.push('');
  return lines.join('\n');
}

function valueOf(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function packageManager() {
  return process.env.MITII_PACKAGE_MANAGER ?? 'pnpm';
}

function avg(nums) {
  const valid = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function sum(nums) {
  return nums.filter((n) => typeof n === 'number' && !Number.isNaN(n)).reduce((a, b) => a + b, 0);
}
