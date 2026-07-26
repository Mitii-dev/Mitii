#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, filterCases, DIFFICULTIES, MODES } from './cases.mjs';
import { validateSuite } from './validate.mjs';
import { runCases } from './runner.mjs';
import { buildReport, writeReport } from './report.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'help', ...args] = process.argv.slice(2);
const allCases = loadCases(rootDir);

if (command === 'validate') {
  const validation = validateSuite(allCases, rootDir);
  console.log(`Cases: ${allCases.length} (${Object.entries(validation.counts).map(([k, v]) => `${k}=${v}`).join(', ')})`);
  if (!validation.valid) {
    for (const error of validation.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log('Suite is valid.');
} else if (command === 'list') {
  const selected = select(allCases, args);
  for (const testCase of selected) {
    console.log(`${testCase.id}\t${testCase.mode}\t${testCase.fixture}\t${testCase.capability}`);
  }
  console.log(`\n${selected.length} case(s)`);
} else if (command === 'run') {
  const validation = validateSuite(allCases, rootDir);
  if (!validation.valid) {
    console.error('Suite validation failed. Run npm run validate for details.');
    process.exit(1);
  }
  const requestedConfig = valueOf(args, '--config');
  const localConfig = join(rootDir, 'benchmark.config.json');
  const configPath = resolve(
    requestedConfig ?? (existsSync(localConfig) ? localConfig : join(rootDir, 'benchmark.config.example.json'))
  );
  if (!existsSync(configPath)) {
    console.error(`Missing config: ${configPath}`);
    process.exit(1);
  }
  if (!requestedConfig && configPath.endsWith('benchmark.config.example.json')) {
    console.log('Using benchmark.config.example.json. Create benchmark.config.json to customize the agent command.');
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  let selected = select(allCases, args);
  const limit = Number(valueOf(args, '--limit') ?? selected.length);
  selected = selected.slice(0, limit);
  if (args.includes('--dry-run')) {
    console.log(`Would run ${selected.length} case(s).`);
    process.exit(0);
  }
  const startedAt = new Date();
  const results = await runCases(selected, rootDir, config, {
    configPath,
    concurrency: Number(valueOf(args, '--concurrency') ?? config.run.concurrency ?? 1),
    keepWorkspaces: args.includes('--keep-workspaces') || config.run.keepWorkspaces,
    onResult(result, index, total) {
      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(`[${index + 1}/${total}] ${status} ${result.id} (${result.durationMs}ms)`);
    },
  });
  const report = buildReport(results, config, startedAt, new Date());
  const reportPath = resolve(valueOf(args, '--output') ?? join(rootDir, '..', 'reports', 'latest.json'));
  const paths = writeReport(report, reportPath);
  console.log(`\nSignal: ${report.signal}`);
  console.log(`JSON: ${paths.json}`);
  console.log(`Markdown: ${paths.markdown}`);
  if (report.signal !== 'GO') process.exitCode = 1;
} else {
  console.log(`Usage:
  node src/cli.mjs validate
  node src/cli.mjs list [--difficulty easy|medium|hard] [--mode ask|plan|agent]
  node src/cli.mjs run --config benchmark.config.json [filters]

Filters:
  --difficulty ${DIFFICULTIES.join('|')}
  --mode ${MODES.join('|')}
  --fixture <name>
  --id <substring>
  --limit <number>
  --concurrency <number>
  --keep-workspaces
  --output <report.json>
  --dry-run`);
}

function select(cases, values) {
  const difficulty = valueOf(values, '--difficulty');
  const mode = valueOf(values, '--mode');
  if (difficulty && !DIFFICULTIES.includes(difficulty)) throw new Error(`Invalid difficulty: ${difficulty}`);
  if (mode && !MODES.includes(mode)) throw new Error(`Invalid mode: ${mode}`);
  return filterCases(cases, {
    difficulty,
    mode,
    fixture: valueOf(values, '--fixture'),
    id: valueOf(values, '--id'),
  });
}

function valueOf(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}
