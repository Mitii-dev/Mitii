import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIFFICULTIES, MODES, listSuites, loadSuiteManifest } from './cases.mjs';

export const CHECK_TYPES = new Set([
  'agent_exit',
  'output_not_empty',
  'output_contains',
  'output_contains_any',
  'output_not_contains',
  'output_regex',
  'jsonl_event',
  'json_path_truthy',
  'file_exists',
  'file_not_exists',
  'file_contains',
  'file_not_contains',
  'file_contains_any',
  'dir_has_files',
  'workspace_unchanged',
  'workspace_changed',
  'file_unchanged',
  'file_changed',
  'command',
  'http',
  'skills_installed',
  'sqlite_query',
  'changed_file_count',
  'workflow_yaml_valid',
]);

const OUTPUT_ASSERTIONS = new Set([
  'output_contains',
  'output_contains_any',
  'output_not_contains',
  'output_regex',
  'jsonl_event',
  'json_path_truthy',
]);

const STATE_ASSERTIONS = new Set([
  'file_exists',
  'file_not_exists',
  'file_contains',
  'file_not_contains',
  'file_contains_any',
  'dir_has_files',
  'workspace_unchanged',
  'workspace_changed',
  'file_unchanged',
  'file_changed',
  'http',
  'sqlite_query',
  'changed_file_count',
  'workflow_yaml_valid',
]);

export function validateSuite(cases, rootDir, options = {}) {
  const errors = [];
  const ids = new Set();
  const familyVariants = new Set();
  const counts = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, 0]));
  const bySuite = {};

  for (const [index, testCase] of cases.entries()) {
    const where = `case[${index}]`;
    if (!testCase.id || typeof testCase.id !== 'string') errors.push(`${where}: missing id`);
    else if (ids.has(testCase.id)) errors.push(`${where}: duplicate id ${testCase.id}`);
    else ids.add(testCase.id);

    const suiteId = testCase.suite ?? 'unknown';
    bySuite[suiteId] = (bySuite[suiteId] ?? 0) + 1;

    if (!DIFFICULTIES.includes(testCase.difficulty)) errors.push(`${testCase.id}: invalid difficulty`);
    else counts[testCase.difficulty] += 1;
    if (!MODES.includes(testCase.mode)) errors.push(`${testCase.id}: invalid mode`);
    if (!testCase.familyId || !Number.isInteger(testCase.variant)) {
      errors.push(`${testCase.id}: missing familyId/variant`);
    } else {
      const key = `${testCase.familyId}:${testCase.variant}`;
      if (familyVariants.has(key)) errors.push(`${testCase.id}: duplicate family variant ${key}`);
      familyVariants.add(key);
    }
    if (!testCase.prompt || typeof testCase.prompt !== 'string') errors.push(`${testCase.id}: missing prompt`);
    if (!testCase.fixture || !existsSync(join(rootDir, 'fixtures', testCase.fixture))) {
      errors.push(`${testCase.id}: fixture not found: ${testCase.fixture}`);
    }
    if (testCase.suite && testCase.suite !== suiteId && options.strictSuiteMatch) {
      errors.push(`${testCase.id}: suite field ${testCase.suite} mismatches folder`);
    }
    validateChecks(testCase.preconditions ?? [], `${testCase.id}.preconditions`, errors);
    validateChecks(testCase.checks, `${testCase.id}.checks`, errors);
    if (!Array.isArray(testCase.checks) || testCase.checks.length === 0) {
      errors.push(`${testCase.id}: checks must be a non-empty array`);
    } else {
      if (!testCase.checks.some((check) => check.type === 'agent_exit')) {
        errors.push(`${testCase.id}: missing agent_exit check`);
      }
      if (!testCase.checks.some((check) => check.type === 'output_not_empty')) {
        errors.push(`${testCase.id}: missing output_not_empty check`);
      }
      if (!testCase.checks.some((check) => OUTPUT_ASSERTIONS.has(check.type))) {
        errors.push(`${testCase.id}: missing a deterministic output assertion`);
      }
      if (
        (testCase.mode === 'ask' || testCase.mode === 'plan') &&
        !testCase.checks.some((check) => check.type === 'workspace_unchanged')
      ) {
        errors.push(`${testCase.id}: ask/plan case must verify workspace_unchanged`);
      }
      if (
        testCase.mode === 'agent' &&
        !testCase.checks.some((check) => check.type === 'command' || check.type === 'http')
      ) {
        errors.push(`${testCase.id}: agent case must execute a command or HTTP check`);
      }
      if (
        testCase.mode === 'agent' &&
        !testCase.checks.some((check) => STATE_ASSERTIONS.has(check.type))
      ) {
        errors.push(`${testCase.id}: agent case must verify repository or HTTP state`);
      }
    }
  }

  const suiteIds =
    options.suite && options.suite !== 'all' ? [options.suite] : listSuites(rootDir);

  for (const suiteId of suiteIds) {
    const manifest = loadSuiteManifest(rootDir, suiteId);
    const suiteCases = cases.filter((testCase) => (testCase.suite ?? suiteId) === suiteId);
    const expected = manifest.expectedCounts ?? {};
    if (expected.total != null && suiteCases.length !== expected.total) {
      errors.push(`suite ${suiteId}: expected ${expected.total} cases, found ${suiteCases.length}`);
    }
    for (const difficulty of DIFFICULTIES) {
      if (expected[difficulty] == null) continue;
      const found = suiteCases.filter((testCase) => testCase.difficulty === difficulty).length;
      if (found !== expected[difficulty]) {
        errors.push(
          `suite ${suiteId}/${difficulty}: expected ${expected[difficulty]} cases, found ${found}`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    counts,
    bySuite,
    uniqueIds: ids.size,
  };
}

function validateChecks(checks, where, errors) {
  if (!Array.isArray(checks)) {
    errors.push(`${where}: expected array`);
    return;
  }
  for (const [index, check] of checks.entries()) {
    if (!check || typeof check !== 'object' || !CHECK_TYPES.has(check.type)) {
      errors.push(`${where}[${index}]: unsupported check ${JSON.stringify(check)}`);
    }
  }
}
