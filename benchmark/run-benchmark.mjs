import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { verifyTask, summarizeVerifications } from './verify.mjs';

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(benchmarkDir, '..');
const args = process.argv.slice(2);
const cwd = resolve(valueOf(args, '--cwd') ?? process.cwd());
const tasksPath = resolve(valueOf(args, '--tasks') ?? join(benchmarkDir, 'tasks/index.json'));
const outputPath = resolve(valueOf(args, '--output') ?? join(cwd, '.mitii/benchmark/report.json'));
const provider = valueOf(args, '--provider') ?? 'echo';
const tier = valueOf(args, '--tier') ?? 'smoke';
const runtime = valueOf(args, '--runtime') ?? (tier === 'smoke' && provider === 'echo' ? 'stub' : 'real');
const approval = valueOf(args, '--approval') ?? 'auto';
const enablePuppeteer = args.includes('--enable-puppeteer');

if (!existsSync(join(packageRoot, 'dist/cli.js'))) {
  const compile = spawnSync('npm', ['run', 'compile:cli'], { cwd: packageRoot, stdio: 'inherit' });
  if (compile.status) process.exit(compile.status ?? 1);
}

const cliPath = join(packageRoot, 'dist/cli.js');
const taskIndex = JSON.parse(readFileSync(tasksPath, 'utf8'));
const selectedTasks = loadTasks(taskIndex, tier);
const fixtureRoot = join(packageRoot, 'benchmark/fixtures');

const results = selectedTasks.map((task) => runTask(task, { cliPath, packageRoot, fixtureRoot }));
const passed = results.filter((result) => result.passed).length;
const report = {
  cwd,
  packageRoot,
  provider,
  runtime,
  tier,
  startedAt: new Date().toISOString(),
  summary: {
    total: results.length,
    passed,
    failed: results.length - passed,
    score: results.length ? Math.round((passed / results.length) * 100) : 0,
  },
  verificationSummary: summarizeVerifications(results),
  results,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(outputPath.replace(/\.json$/, '.md'), toMarkdown(report), 'utf8');
console.log(`${passed}/${results.length} benchmark tasks passed (${report.summary.score}%)`);
if (passed !== results.length) process.exitCode = 1;

function loadTasks(index, selectedTier) {
  const baseDir = dirname(tasksPath);
  const files = Array.isArray(index.includes) ? index.includes : [index.tasksFile ?? 'tasks.json'];
  const all = files.flatMap((file) => {
    const path = resolve(baseDir, file);
    return JSON.parse(readFileSync(path, 'utf8'));
  });
  return all.filter((task) => !task.tier || task.tier === selectedTier || selectedTier === 'all');
}

function runTask(task, ctx) {
  const fixtureCwd = task.fixture ? join(ctx.fixtureRoot, task.fixture) : cwd;
  const extraArgs = [
    '--cwd', fixtureCwd,
    '--provider', provider,
    '--runtime', runtime,
    '--approval', approval,
  ];
  if (enablePuppeteer || task.enablePuppeteer) extraArgs.push('--enable-puppeteer');
  if (task.model) extraArgs.push('--model', task.model);
  const taskRuntime = task.runtime ?? runtime;
  const runtimeIndex = extraArgs.indexOf('--runtime');
  if (runtimeIndex >= 0) extraArgs[runtimeIndex + 1] = taskRuntime;

  const cliArgs = [ctx.cliPath, task.mode, task.prompt, ...extraArgs];
  if (task.mode !== 'ask') cliArgs.push('--json');

  const started = Date.now();
  const result = spawnSync('node', cliArgs, { cwd: packageRoot, encoding: 'utf8', env: process.env });
  const durationMs = Date.now() - started;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const verifications = (task.verify ?? []).map((rule) => verifyTask(rule, {
    stdout,
    stderr,
    exitCode: result.status ?? 1,
    cwd: fixtureCwd,
    packageRoot: ctx.packageRoot,
    mode: task.mode,
  }));
  const passed = result.status === 0 && verifications.every((v) => v.passed);

  return {
    id: task.id,
    category: task.category ?? 'general',
    mode: task.mode,
    fixture: task.fixture ?? null,
    passed,
    durationMs,
    exitCode: result.status,
    verifications,
    stdout: stdout.slice(0, 4000),
    stderr: stderr.slice(0, 2000),
  };
}

function valueOf(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function toMarkdown(report) {
  return [
    '# Mitii Enterprise Benchmark Report',
    '',
    `Provider: ${report.provider}`,
    `Runtime: ${report.runtime}`,
    `Tier: ${report.tier}`,
    `Score: ${report.summary.passed}/${report.summary.total} (${report.summary.score}%)`,
    '',
    '## Verification summary',
    ...Object.entries(report.verificationSummary).map(([k, v]) => `- ${k}: ${v.passed}/${v.total}`),
    '',
    '| Task | Category | Mode | Fixture | Result | Duration |',
    '|---|---|---|---|---:|---:|',
    ...report.results.map((result) =>
      `| ${result.id} | ${result.category} | ${result.mode} | ${result.fixture ?? '-'} | ${result.passed ? 'pass' : 'fail'} | ${result.durationMs} ms |`
    ),
    '',
  ].join('\n');
}
