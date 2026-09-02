#!/usr/bin/env node
/**
 * Re-run a fixed set of case IDs with --keep-workspaces so diffs + full
 * agent stdout (.mitii/benchmark-agent.stdout) can be inspected.
 *
 * Usage:
 *   node scripts/rerun-failed-subset.mjs [--concurrency N]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadCases } from '../src/cases.mjs';
import { runCases } from '../src/runner.mjs';
import { createRunReporter } from '../src/report.mjs';

const FAILED_IDS = [
  'fe-bugfix-010-loading-docs-color-v1',
  'be-medium-004-nest-api-list-users-pagination-v1',
  'be-medium-007-saas-api-orders-cart-repository-v1',
  'be-hard-009-legacy-commonjs-request-logging-v1',
  'be-hard-008-monorepo-signup-duplicate-email-v1',
  'be-robust-002-monorepo-web-symptom-report-v1',
  'be-robust-003-broken-repo-scope-discipline-v1',
  'be-robust-007-saas-api-vague-investigate-v1',
  'be-auth-002-node-express-login-bearer-token-v1',
  'be-auth-003-node-express-token-expiry-v1',
  'be-auth-004-nest-api-guard-v1',
  'cicd-easy-002-node-express-lint-gate-v1',
  'cicd-hard-004-node-express-verify-entrypoint-v1',
  'cicd-hard-005-legacy-commonjs-esm-migration-v1',
  'cicd-medium-002-monorepo-ci-matrix-v1',
  'test-easy-001-node-express-health-test-v1',
  'test-easy-006-node-express-users-id-test-v1',
  'test-hard-007-node-express-response-headers-test-v1',
  'test-medium-002-broken-repo-reserve-endpoint-test-v1',
  'test-medium-004-node-express-api-surface-test-v1',
  'test-medium-005-node-express-concurrent-requests-test-v1',
];

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(rootDir, 'benchmark.config.json');
if (!existsSync(configPath)) {
  console.error(`Missing config: ${configPath}`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const concurrencyArg = process.argv.indexOf('--concurrency');
const concurrency = concurrencyArg >= 0
  ? Number(process.argv[concurrencyArg + 1])
  : (config.run.concurrency ?? 1);

const idSet = new Set(FAILED_IDS);
const allCases = loadCases(rootDir, { suite: 'all' });
const selected = allCases.filter((c) => idSet.has(c.id));
const missing = FAILED_IDS.filter((id) => !selected.some((c) => c.id === id));
if (missing.length) {
  console.error('Missing case defs:', missing.join(', '));
  process.exit(1);
}

const startedAt = new Date();
const runId = `${startedAt.toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const reportRoot = join(rootDir, 'reports');
const runDir = join(reportRoot, 'runs', runId);
const latestPath = join(reportRoot, 'failed-subset-latest.json');

const reporter = createRunReporter({
  runId,
  runDir,
  startedAt,
  config,
  suite: 'failed-subset',
  latestPath,
  expectedByDifficulty: null,
  expectedTotal: selected.length,
});

console.log(`Run ${runId}`);
console.log(`Re-running ${selected.length} previously failed cases`);
console.log(`keepWorkspaces=true concurrency=${concurrency}`);
console.log(`Per-case reports: ${join(runDir, 'cases')}`);
console.log(`Workspaces: ${join(rootDir, '.workspaces', runId)}`);

const workRoot = join(rootDir, '.workspaces', runId);
const results = await runCases(selected, rootDir, config, {
  configPath,
  concurrency,
  keepWorkspaces: true,
  workRoot,
  onResult(result, index, total) {
    const { casePaths } = reporter.record(result, index, total);
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(
      `[${index + 1}/${total}] ${status} ${result.suite}/${result.difficulty} ${result.id} (${result.durationMs}ms)`
    );
    console.log(`  report: ${casePaths.markdown}`);
    if (result.workspace) console.log(`  workspace: ${result.workspace}`);
  },
});

const { report, summaryPaths } = reporter.finalize(results);
const passed = results.filter((r) => r.passed).length;
console.log(`\nDone: ${passed}/${results.length} passed`);
console.log(`Signal: ${report.signal}`);
console.log(`Summary: ${summaryPaths.markdown}`);
console.log(`Viewer: ${summaryPaths.html}`);
console.log(`Workspaces kept under: ${workRoot}`);
if (report.signal !== 'GO' && report.signal !== 'RUNNING') process.exitCode = 1;
