#!/usr/bin/env node
/**
 * External eval runner — parallel, sharded execution of 500–1000 tasks.
 * Reuses tools/benchmark/verify.mjs; generated tasks live under tools/benchmark/tasks/eval.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { verifyTask, summarizeVerifications } from '../verify.mjs';
import { runEvalPreflight } from './preflight.mjs';

const benchmarkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(benchmarkDir, '../..');
const args = normalizeArgs(process.argv.slice(2));

const tasksPath = resolve(valueOf(args, '--tasks') ?? join(benchmarkDir, 'tasks/eval/generated/index.json'));
const outputPath = resolve(valueOf(args, '--output') ?? join(packageRoot, '.mitii/eval/report.json'));
const provider = valueOf(args, '--provider') ?? 'echo';
const tier = valueOf(args, '--tier') ?? 'eval';
const runtime = valueOf(args, '--runtime') ?? (provider === 'echo' ? 'stub' : 'real');
const approval = valueOf(args, '--approval') ?? 'auto';
const concurrency = Math.max(1, Number(valueOf(args, '--concurrency') ?? '4'));
const limit = valueOf(args, '--limit') ? Number(valueOf(args, '--limit')) : undefined;
const shardSpec = valueOf(args, '--shard'); // e.g. "1/4" = shard 1 of 4
const timeoutMs = Number(valueOf(args, '--timeout-ms') ?? '120000');
const enablePuppeteer = args.includes('--enable-puppeteer');
const dryRun = args.includes('--dry-run');
const ensureReady = args.includes('--ensure-ready') || (!args.includes('--no-ensure-ready') && runtime === 'real');

if (!existsSync(join(packageRoot, 'dist/cli.js'))) {
  await compileCli();
}

if (ensureReady) {
  ensureEvalTasks(tasksPath);
}

if (runtime === 'real' && !dryRun) {
  const preflight = runEvalPreflight({ autoRebuild: !args.includes('--no-rebuild') });
  if (!preflight.ok) {
    console.error(preflight.message);
    process.exit(1);
  }
}

const cliPath = join(packageRoot, 'dist/cli.js');
const fixtureRoot = join(benchmarkDir, 'fixtures');
const cwd = resolve(valueOf(args, '--cwd') ?? packageRoot);

let selectedTasks = loadTasks(tasksPath, tier);
if (shardSpec) {
  const [idx, total] = shardSpec.split('/').map(Number);
  if (!idx || !total || idx < 1 || idx > total) {
    console.error('Invalid --shard; use e.g. --shard 1/4');
    process.exit(1);
  }
  selectedTasks = selectedTasks.filter((_, i) => i % total === idx - 1);
}
if (limit !== undefined) selectedTasks = selectedTasks.slice(0, limit);

if (dryRun) {
  console.log(`Dry run: ${selectedTasks.length} tasks (concurrency ${concurrency}, runtime ${runtime})`);
  process.exit(0);
}

const startedAt = new Date().toISOString();
const results = await runPool(selectedTasks, concurrency);
const passed = results.filter((r) => r.passed).length;

const report = {
  cwd,
  packageRoot,
  provider,
  runtime,
  tier,
  shard: shardSpec ?? null,
  concurrency,
  startedAt,
  finishedAt: new Date().toISOString(),
  summary: {
    total: results.length,
    passed,
    failed: results.length - passed,
    score: results.length ? Math.round((passed / results.length) * 100) : 0,
    avgDurationMs: results.length
      ? Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length)
      : 0,
  },
  categoryBreakdown: summarizeByCategory(results),
  verificationSummary: summarizeVerifications(results),
  results,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(outputPath.replace(/\.json$/, '.md'), toMarkdown(report), 'utf8');
console.log(`${passed}/${results.length} eval tasks passed (${report.summary.score}%)`);
printFailureHint(results, passed);
if (passed !== results.length) process.exitCode = 1;

function loadTasks(indexPath, selectedTier) {
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const baseDir = dirname(indexPath);
  const files = Array.isArray(index.includes) ? index.includes : [index.tasksFile ?? 'tasks.json'];
  const all = files.flatMap((file) => {
    const path = resolve(baseDir, file);
    return JSON.parse(readFileSync(path, 'utf8'));
  });
  return all.filter((task) => !task.tier || task.tier === selectedTier || selectedTier === 'all' || task.tier === 'eval');
}

async function runPool(tasks, poolSize) {
  const results = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await runTaskAsync(tasks[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(poolSize, tasks.length) }, () => worker()));
  return results;
}

function runTaskAsync(task) {
  return new Promise((resolvePromise) => {
    const fixtureCwd = task.fixture ? join(fixtureRoot, task.fixture) : cwd;
    const extraArgs = [
      '--cwd', fixtureCwd,
      '--provider', provider,
      '--runtime', task.runtime ?? runtime,
      '--approval', approval,
    ];
    if (enablePuppeteer || task.enablePuppeteer) extraArgs.push('--enable-puppeteer');
    if (task.model) extraArgs.push('--model', task.model);
    if (valueOf(args, '--model')) extraArgs.push('--model', valueOf(args, '--model'));
    if (valueOf(args, '--base-url')) extraArgs.push('--base-url', valueOf(args, '--base-url'));

    const cliArgs = [cliPath, task.mode, task.prompt, ...extraArgs];
    if (task.mode !== 'ask') cliArgs.push('--json');

    const started = Date.now();
    const child = spawn('node', cliArgs, { cwd: packageRoot, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });

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
      const passed = exitCode === 0 && verifications.every((v) => v.passed);

      resolvePromise({
        id: task.id,
        category: task.category ?? 'general',
        mode: task.mode,
        fixture: task.fixture ?? null,
        passed,
        durationMs,
        exitCode,
        timedOut,
        verifications,
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 2000),
      });
    });
  });
}

function summarizeByCategory(results) {
  const map = {};
  for (const r of results) {
    const cat = r.category ?? 'unknown';
    if (!map[cat]) map[cat] = { passed: 0, total: 0 };
    map[cat].total += 1;
    if (r.passed) map[cat].passed += 1;
  }
  for (const cat of Object.keys(map)) {
    const { passed, total } = map[cat];
    map[cat].score = total ? Math.round((passed / total) * 100) : 0;
  }
  return map;
}

function normalizeArgs(argv) {
  return argv.filter((arg) => arg !== '--');
}

function valueOf(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function printFailureHint(results, passed) {
  if (passed > 0 || !results.length) return;

  const stderrSamples = results
    .map((result) => result.stderr?.trim())
    .filter(Boolean);
  if (!stderrSamples.length) return;

  const common = stderrSamples[0];
  const allSame = stderrSamples.every((sample) => sample === common);
  if (!allSame) return;

  if (/NODE_MODULE_VERSION/i.test(common)) {
    console.error('');
    console.error('All tasks failed before the agent could run.');
    console.error('better-sqlite3 is built for Electron, not your system Node.');
    console.error('Fix: pnpm run rebuild:node && pnpm run eval:preflight');
    console.error('');
    return;
  }

  if (stderrSamples.length === results.length) {
    console.error('');
    console.error('All tasks failed with the same error:');
    console.error(common.split('\n').slice(0, 6).join('\n'));
    console.error('');
  }
}

function toMarkdown(report) {
  return [
    '# Mitii External Eval Report',
    '',
    `Provider: ${report.provider}`,
    `Runtime: ${report.runtime}`,
    `Score: ${report.summary.passed}/${report.summary.total} (${report.summary.score}%)`,
    `Avg duration: ${report.summary.avgDurationMs} ms`,
    '',
    '## Category breakdown',
    ...Object.entries(report.categoryBreakdown).map(
      ([cat, v]) => `- ${cat}: ${v.passed}/${v.total} (${v.score}%)`
    ),
    '',
    '| Task | Category | Mode | Result | Duration |',
    '|---|---|---|---:|---:|',
    ...report.results.map((r) =>
      `| ${r.id} | ${r.category} | ${r.mode} | ${r.passed ? 'pass' : 'fail'} | ${r.durationMs} ms |`
    ),
    '',
  ].join('\n');
}

function compileCli() {
  return new Promise((resolveCompile, reject) => {
    const child = spawn(packageManager(), ['run', 'compile:cli'], {
      cwd: packageRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('close', (code) => (code ? reject(new Error('compile:cli failed')) : resolveCompile()));
  });
}

function ensureEvalTasks(indexPath) {
  const manifestPath = join(dirname(indexPath), 'manifest.json');
  const minTasks = 100;
  let needsGenerate = !existsSync(indexPath);

  if (!needsGenerate && existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.profile === 'smoke' || (manifest.actualCount ?? 0) < minTasks) {
        needsGenerate = true;
        console.log(
          `Regenerating eval tasks (found ${manifest.actualCount ?? 0} ${manifest.profile ?? 'unknown'} tasks; need ≥${minTasks}).`
        );
      }
    } catch {
      needsGenerate = true;
    }
  }

  if (!needsGenerate) return;

  const gen = spawnSync('node', [join(benchmarkDir, 'scripts/generate-tasks.mjs'), '--profile', 'standard'], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  if (gen.status !== 0) {
    console.error('Failed to generate standard eval tasks. Run: pnpm run eval:generate');
    process.exit(gen.status ?? 1);
  }
}

function packageManager() {
  return process.env.MITII_PACKAGE_MANAGER ?? 'pnpm';
}
