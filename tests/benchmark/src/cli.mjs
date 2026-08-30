#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  loadCases,
  filterCases,
  listSuites,
  loadSuiteManifest,
  DOMAINS,
  DIFFICULTIES,
  MODES,
} from './cases.mjs';
import { validateSuite } from './validate.mjs';
import { runCases } from './runner.mjs';
import { createRunReporter } from './report.mjs';
import { generateViewer } from './html-report.mjs';
import { generateCasesViewer } from './cases-viewer.mjs';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'help', ...args] = process.argv.slice(2);
const suiteFilter = valueOf(args, '--suite') ?? 'all';
const availableSuites = listSuites(rootDir);

if (command === 'validate') {
  const allCases = loadCases(rootDir, { suite: suiteFilter });
  const validation = validateSuite(allCases, rootDir, { suite: suiteFilter });
  console.log(
    `Domain: ${suiteFilter} | Cases: ${allCases.length} (${Object.entries(validation.bySuite)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')})`
  );
  if (!validation.valid) {
    for (const error of validation.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log('Suite is valid.');
} else if (command === 'list') {
  const allCases = loadCases(rootDir, { suite: suiteFilter });
  const selected = select(allCases, args);
  for (const testCase of selected) {
    console.log(
      `${testCase.id}\t${testCase.suite}\t${testCase.difficulty}\t${testCase.mode}\t${testCase.fixture}`
    );
  }
  console.log(`\n${selected.length} case(s)`);
} else if (command === 'suites') {
  for (const suiteId of availableSuites) {
    const manifest = loadSuiteManifest(rootDir, suiteId);
    const counts = manifest.expectedCounts ?? {};
    console.log(
      `${suiteId}\t${manifest.name}\teasy=${counts.easy ?? 0}\tmedium=${counts.medium ?? 0}\thard=${counts.hard ?? 0}\ttotal=${counts.total ?? '?'}`
    );
  }
} else if (command === 'run') {
  const allCases = loadCases(rootDir, { suite: suiteFilter });
  const validation = validateSuite(allCases, rootDir, { suite: suiteFilter });
  if (!validation.valid) {
    console.error('Suite validation failed. Run npm run validate for details.');
    for (const error of validation.errors.slice(0, 20)) console.error(`- ${error}`);
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
    console.log(
      'Using benchmark.config.example.json. Create benchmark.config.json to customize the agent command.'
    );
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  let expectedByDifficulty = null;
  let expectedTotal = null;
  if (suiteFilter !== 'all') {
    const manifest = loadSuiteManifest(rootDir, suiteFilter);
    config.gates = { ...config.gates, ...(manifest.gates ?? {}) };
    expectedByDifficulty = {
      easy: manifest.expectedCounts?.easy ?? 0,
      medium: manifest.expectedCounts?.medium ?? 0,
      hard: manifest.expectedCounts?.hard ?? 0,
    };
    expectedTotal = manifest.expectedCounts?.total ?? null;
  }

  let selected = select(allCases, args);
  const limit = Number(valueOf(args, '--limit') ?? selected.length);
  selected = selected.slice(0, limit);
  if (args.includes('--dry-run')) {
    console.log(`Would run ${selected.length} case(s) from domain=${suiteFilter}.`);
    process.exit(0);
  }

  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const reportRoot = resolve(valueOf(args, '--output-dir') ?? join(rootDir, 'reports'));
  const runDir = join(reportRoot, 'runs', runId);
  const latestPath = resolve(
    valueOf(args, '--output') ??
      join(reportRoot, suiteFilter === 'all' ? 'latest.json' : `${suiteFilter}-latest.json`)
  );
  const reporter = createRunReporter({
    runId,
    runDir,
    startedAt,
    config,
    suite: suiteFilter,
    latestPath,
    expectedByDifficulty,
    expectedTotal,
  });

  console.log(`Run ${runId}`);
  console.log(`Domain: ${suiteFilter}`);
  console.log(`Per-case reports: ${join(runDir, 'cases')}`);
  console.log(`Live summary: ${join(runDir, 'summary.md')}`);
  console.log(`Run viewer: ${join(runDir, 'summary.html')}`);

  const results = await runCases(selected, rootDir, config, {
    configPath,
    concurrency: Number(valueOf(args, '--concurrency') ?? config.run.concurrency ?? 1),
    keepWorkspaces: args.includes('--keep-workspaces') || config.run.keepWorkspaces,
    onResult(result, index, total) {
      const { casePaths } = reporter.record(result, index, total);
      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(
        `[${index + 1}/${total}] ${status} ${result.suite}/${result.difficulty} ${result.id} (${result.durationMs}ms)`
      );
      console.log(`  report: ${casePaths.markdown}`);
    },
  });

  const { report, summaryPaths } = reporter.finalize(results);
  console.log(`\nSignal: ${report.signal}`);
  console.log(`Run summary: ${summaryPaths.markdown}`);
  console.log(`Run viewer: ${summaryPaths.html}`);
  console.log(`Latest: ${latestPath.replace(/\.json$/i, '.md')}`);
  console.log(`All runs: ${join(reportRoot, 'index.html')}`);
  if (report.signal !== 'GO' && report.signal !== 'RUNNING') process.exitCode = 1;
} else if (command === 'view') {
  const reportRoot = resolve(valueOf(args, '--output-dir') ?? join(rootDir, 'reports'));
  const runId = valueOf(args, '--run');
  const { indexPath, written, runs } = generateViewer(reportRoot, { runId });
  const casesPath = generateCasesViewer(rootDir, reportRoot);
  if (runId && written.length === 0) {
    console.error(`No summary found for run: ${runId}`);
    process.exit(1);
  }
  console.log(`Index: ${indexPath} (${runs.length} run${runs.length === 1 ? '' : 's'})`);
  for (const path of written) console.log(`Viewer: ${path}`);
  console.log(`Test case browser: ${casesPath}`);
  const openTarget = runId && written[0] ? written[0] : indexPath;
  if (args.includes('--open')) {
    openPath(openTarget);
    console.log(`Opened ${openTarget}`);
  } else {
    console.log(`Open in browser: ${pathToFileURL(openTarget).href}`);
  }
} else if (command === 'cases') {
  const reportRoot = resolve(valueOf(args, '--output-dir') ?? join(rootDir, 'reports'));
  const casesPath = generateCasesViewer(rootDir, reportRoot);
  console.log(`Test case browser: ${casesPath}`);
  if (args.includes('--open')) {
    openPath(casesPath);
    console.log(`Opened ${casesPath}`);
  } else {
    console.log(`Open in browser: ${pathToFileURL(casesPath).href}`);
  }
} else {
  console.log(`Usage:
  node src/cli.mjs validate [--suite all|${DOMAINS.join('|')}]
  node src/cli.mjs list [--suite ...] [--difficulty easy|medium|hard] [--mode ...]
  node src/cli.mjs suites
  node src/cli.mjs run --config benchmark.config.json [filters]
  node src/cli.mjs view [--run <runId>] [--output-dir <reports-root>] [--open]
  node src/cli.mjs cases [--output-dir <reports-root>] [--open]   (read-only test case browser)

Domains (top-level):
  ${availableSuites.join(' | ') || DOMAINS.join(' | ')}

Each domain contains case JSONL files (frontend: capability files; others: easy/medium/hard).

Filters:
  --suite all|${availableSuites.join('|') || DOMAINS.join('|')}
  --difficulty ${DIFFICULTIES.join('|')}
  --mode ${MODES.join('|')}
  --fixture <name>
  --category <name>
  --id <substring>
  --limit <number>
  --concurrency <number>
  --keep-workspaces
  --output <latest-report.json>
  --output-dir <reports-root>
  --dry-run`);
}

function openPath(target) {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform() === 'win32' ? ['/c', 'start', '', target] : [target];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

function select(cases, values) {
  const difficulty = valueOf(values, '--difficulty');
  const mode = valueOf(values, '--mode');
  if (difficulty && !DIFFICULTIES.includes(difficulty)) throw new Error(`Invalid difficulty: ${difficulty}`);
  if (mode && !MODES.includes(mode)) throw new Error(`Invalid mode: ${mode}`);
  return filterCases(cases, {
    suite:
      valueOf(values, '--suite') && valueOf(values, '--suite') !== 'all'
        ? valueOf(values, '--suite')
        : undefined,
    difficulty,
    mode,
    fixture: valueOf(values, '--fixture'),
    category: valueOf(values, '--category'),
    id: valueOf(values, '--id'),
  });
}

function valueOf(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}
