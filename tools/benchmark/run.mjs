import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { verifyTask, summarizeVerifications } from './verify.mjs';

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(benchmarkDir, '../..');
const args = process.argv.slice(2);
const cwd = resolve(valueOf(args, '--cwd') ?? packageRoot);
const tasksPath = resolve(valueOf(args, '--tasks') ?? join(benchmarkDir, 'tasks/enterprise/index.json'));
const outputPath = resolve(valueOf(args, '--output') ?? join(cwd, '.mitii/benchmark/report.json'));
const provider = valueOf(args, '--provider') ?? 'echo';
const tier = valueOf(args, '--tier') ?? 'smoke';
const runtime = valueOf(args, '--runtime') ?? (tier === 'smoke' && provider === 'echo' ? 'stub' : 'real');
const approval = valueOf(args, '--approval') ?? 'auto';
const baseUrl = valueOf(args, '--base-url');
const model = valueOf(args, '--model');
const apiKey = valueOf(args, '--api-key');
const enablePuppeteer = args.includes('--enable-puppeteer');
const verbose = args.includes('--verbose') || args.includes('-v');

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
const taskIndex = JSON.parse(readFileSync(tasksPath, 'utf8'));
const selectedTasks = loadTasks(taskIndex, tier);
const fixtureRoot = join(benchmarkDir, 'fixtures');

console.log(
  `\nRunning ${selectedTasks.length} benchmark task(s) — tier=${tier}, provider=${provider}, runtime=${runtime}\n`
);

const results = [];
for (const [index, task] of selectedTasks.entries()) {
  const result = await runTask(task, { cliPath, packageRoot, fixtureRoot, index, total: selectedTasks.length });
  results.push(result);
}

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
console.log(`\n${passed}/${results.length} benchmark tasks passed (${report.summary.score}%)`);
console.log(`Report written to ${outputPath}`);
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
  extraArgs.push('--vectors');
  if (enablePuppeteer || task.enablePuppeteer) extraArgs.push('--enable-puppeteer');
  if (baseUrl) extraArgs.push('--base-url', baseUrl);
  if (apiKey) extraArgs.push('--api-key', apiKey);
  const taskModel = task.model ?? model;
  if (taskModel) extraArgs.push('--model', taskModel);
  const taskRuntime = task.runtime ?? runtime;
  const runtimeIndex = extraArgs.indexOf('--runtime');
  if (runtimeIndex >= 0) extraArgs[runtimeIndex + 1] = taskRuntime;

  const cliArgs = [ctx.cliPath, task.mode, task.prompt, ...extraArgs];
  if (task.mode !== 'ask') cliArgs.push('--json');

  const label = `[${ctx.index + 1}/${ctx.total}]`;
  console.log(`${label} ▶ ${task.id} (${task.mode}${task.fixture ? `, ${task.fixture}` : ''})`);

  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn('node', cliArgs, { cwd: packageRoot, env: process.env });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (verbose) process.stdout.write(`${label}   ${chunk}`);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      if (verbose) process.stderr.write(`${label}   ${chunk}`);
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - started;
      const verifications = (task.verify ?? []).map((rule) => verifyTask(rule, {
        stdout,
        stderr,
        exitCode: code ?? 1,
        cwd: fixtureCwd,
        packageRoot: ctx.packageRoot,
        mode: task.mode,
      }));
      const passed = code === 0 && verifications.every((v) => v.passed);

      console.log(
        `${label} ${passed ? '✓ pass' : '✗ FAIL'} — ${task.id} (${durationMs}ms)`
      );
      if (!passed && !verbose) {
        const failedChecks = verifications.filter((v) => !v.passed).map((v) => v.rule ?? v.name).filter(Boolean);
        if (failedChecks.length) console.log(`${label}   failed checks: ${failedChecks.join(', ')}`);
        if (code !== 0) console.log(`${label}   exit code: ${code}`);
        if (stderr.trim()) console.log(`${label}   stderr: ${stderr.trim().slice(0, 500)}`);
      }

      resolvePromise({
        id: task.id,
        category: task.category ?? 'general',
        mode: task.mode,
        fixture: task.fixture ?? null,
        passed,
        durationMs,
        exitCode: code,
        verifications,
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 2000),
      });
    });
  });
}

function valueOf(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function packageManager() {
  return process.env.MITII_PACKAGE_MANAGER ?? 'pnpm';
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
