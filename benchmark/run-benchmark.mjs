import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';

const cwd = resolve(process.argv.includes('--cwd') ? process.argv[process.argv.indexOf('--cwd') + 1] : process.cwd());
const tasksPath = resolve(process.argv.includes('--tasks') ? process.argv[process.argv.indexOf('--tasks') + 1] : 'benchmark/tasks.json');
const outputPath = resolve(process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : '.mitii/benchmark/report.json');
const provider = process.argv.includes('--provider') ? process.argv[process.argv.indexOf('--provider') + 1] : 'echo';
if (!existsSync('dist/cli.js')) {
  const compile = spawnSync('npm', ['run', 'compile:cli'], { cwd, stdio: 'inherit' });
  if (compile.status) process.exit(compile.status ?? 1);
}
const cliPath = 'dist/cli.js';
const tasks = JSON.parse(readFileSync(tasksPath, 'utf8'));

const results = tasks.map((task) => runTask(task));
const passed = results.filter((result) => result.passed).length;
const report = {
  cwd,
  provider,
  startedAt: new Date().toISOString(),
  summary: {
    total: results.length,
    passed,
    failed: results.length - passed,
  },
  results,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(outputPath.replace(/\.json$/, '.md'), toMarkdown(report), 'utf8');
console.log(`${passed}/${results.length} benchmark tasks passed`);
if (passed !== results.length) process.exitCode = 1;

function runTask(task) {
  const args = [cliPath, task.mode, task.prompt, '--cwd', cwd, '--provider', provider];
  if (task.mode !== 'ask') args.push('--json');
  const started = Date.now();
  const result = spawnSync('node', args, { cwd, encoding: 'utf8' });
  const durationMs = Date.now() - started;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const passed = result.status === 0 && verify(task.verify, stdout);
  return {
    id: task.id,
    mode: task.mode,
    passed,
    durationMs,
    exitCode: result.status,
    stdout: stdout.slice(0, 4000),
    stderr: stderr.slice(0, 2000),
  };
}

function verify(rule, stdout) {
  if (!rule) return true;
  if (rule.startsWith('stdout_contains:')) return stdout.includes(rule.slice('stdout_contains:'.length));
  if (rule.startsWith('json_path:')) {
    const key = rule.slice('json_path:'.length);
    try {
      return Boolean(JSON.parse(stdout)[key]);
    } catch {
      return false;
    }
  }
  if (rule.startsWith('jsonl_event:')) {
    const type = rule.slice('jsonl_event:'.length);
    return stdout.split(/\r?\n/).some((line) => {
      try {
        return JSON.parse(line).type === type;
      } catch {
        return false;
      }
    });
  }
  return false;
}

function toMarkdown(report) {
  return [
    '# Mitii Benchmark Report',
    '',
    `Provider: ${report.provider}`,
    `Score: ${report.summary.passed}/${report.summary.total}`,
    '',
    '| Task | Mode | Result | Duration |',
    '|---|---|---|---:|',
    ...report.results.map((result) =>
      `| ${result.id} | ${result.mode} | ${result.passed ? 'pass' : 'fail'} | ${result.durationMs} ms |`
    ),
    '',
  ].join('\n');
}
