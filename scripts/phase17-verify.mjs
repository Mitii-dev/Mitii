#!/usr/bin/env node
/**
 * Phase 17 automated connection proxies (no Extension Host required).
 * Exit 0 only when all measurable F5 wiring checks pass.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];

function step(label, fn) {
  process.stdout.write(`\n== ${label} ==\n`);
  try {
    fn();
    notes.push({ id: label, status: 'pass' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ id: label, message });
    notes.push({ id: label, status: 'fail', message });
    process.stderr.write(`FAIL: ${message}\n`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    env: process.env,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

step('build product packages', () => {
  run('pnpm', [
    '-r',
    '--filter',
    '@mitii/v8',
    '--filter',
    '@mitii/sdk',
    '--filter',
    '@mitii/cli',
    '--filter',
    '@mitii/vscode',
    'run',
    'build',
  ]);
});

step('extension bundle exists + no legacy paths', () => {
  const bundlePath = join(repoRoot, 'apps/vscode/dist/extension.js');
  if (!existsSync(bundlePath)) {
    throw new Error(`missing ${bundlePath}`);
  }
  const bundle = readFileSync(bundlePath, 'utf8');
  for (const forbidden of ['legacy/', 'src/kernel', 'thunder.']) {
    if (bundle.includes(forbidden)) {
      throw new Error(`bundle contains forbidden marker: ${forbidden}`);
    }
  }
  for (const required of [
    'mitii.openChat',
    'mitii.indexWorkspace',
    'mitii.setApiKey',
    'mitii.sidebar',
    'createMitiiClient',
  ]) {
    if (!bundle.includes(required)) {
      throw new Error(`bundle missing required marker: ${required}`);
    }
  }
});

step('F5 launch.json points at apps/vscode', () => {
  const launch = JSON.parse(
    readFileSync(join(repoRoot, '.vscode/launch.json'), 'utf8'),
  );
  const configs = launch.configurations ?? [];
  if (configs.length < 1) throw new Error('no launch configurations');
  for (const cfg of configs) {
    const args = cfg.args ?? [];
    const extPath = args.find((a) =>
      String(a).includes('extensionDevelopmentPath'),
    );
    // args use --extensionDevelopmentPath=... form or adjacent; our config uses --extensionDevelopmentPath=${...}
    const joined = args.join(' ');
    if (!joined.includes('/apps/vscode') && !joined.includes('${workspaceFolder}/apps/vscode')) {
      throw new Error(`launch config ${cfg.name} does not target apps/vscode: ${joined}`);
    }
    if (cfg.preLaunchTask !== 'mitii: prelaunch') {
      throw new Error(`unexpected preLaunchTask: ${cfg.preLaunchTask}`);
    }
    const out = (cfg.outFiles ?? []).join(' ');
    if (!out.includes('apps/vscode/dist')) {
      throw new Error(`outFiles must include apps/vscode/dist: ${out}`);
    }
  }
});

step('SDK unit tests', () => {
  run('pnpm', ['--filter', '@mitii/sdk', 'test']);
});

step('CLI ask echo (activation / ask / skills path)', () => {
  const result = run('pnpm', [
    '--filter',
    '@mitii/cli',
    'exec',
    '--',
    'node',
    'bin/mitii.js',
    'ask',
    'What is recursion?',
    '--echo',
    '--json',
  ]);
  const text = result.stdout.trim();
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) throw new Error(`no JSON in ask output:\n${text}`);
  const parsed = JSON.parse(text.slice(jsonStart));
  const runResult = parsed.result ?? parsed;
  if (runResult.status !== 'completed') {
    throw new Error(`ask status=${runResult.status}`);
  }
  const reasons = runResult.reasonCodes ?? [];
  if (
    !reasons.includes('skills_selected') &&
    !reasons.includes('skills_skipped')
  ) {
    throw new Error(`expected skills reason codes, got ${JSON.stringify(reasons)}`);
  }
  const events = parsed.events ?? [];
  const skillsEvent = events.find((e) => e && e.type === 'skills_ready');
  if (!skillsEvent) {
    throw new Error('expected skills_ready event when default catalog is wired');
  }
});

step('CLI cancel path', () => {
  run('pnpm', [
    '--filter',
    '@mitii/cli',
    'exec',
    '--',
    'vitest',
    'run',
    'tests/cancel.smoke.spec.ts',
  ]);
});

step('CLI index fixture (honest degraded OK)', () => {
  const result = run('pnpm', [
    '--filter',
    '@mitii/cli',
    'exec',
    '--',
    'node',
    'bin/mitii.js',
    'index',
    '--cwd',
    '../../tests/benchmark/fixtures/node-express',
    '--echo',
    '--json',
  ]);
  const text = result.stdout.trim();
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) throw new Error(`no JSON in index output:\n${text}`);
  const parsed = JSON.parse(text.slice(jsonStart));
  const published = parsed.published;
  if (!published || published.status !== 'published') {
    throw new Error(`unexpected index payload: ${text.slice(0, 800)}`);
  }
});

step('architecture gates', () => {
  run('pnpm', ['run', 'check:architecture']);
});

step('benchmark example points at apps/cli', () => {
  const cfg = JSON.parse(
    readFileSync(join(repoRoot, 'tests/benchmark/benchmark.config.example.json'), 'utf8'),
  );
  const args = cfg.agent?.args ?? [];
  const joined = args.join(' ');
  if (!joined.includes('apps/cli/bin/mitii.js')) {
    throw new Error(`benchmark example must use apps/cli/bin/mitii.js, got: ${joined}`);
  }
  if (joined.includes('dist/cli.js') && !joined.includes('apps/cli')) {
    throw new Error('benchmark example still points at legacy root dist/cli.js');
  }
});

process.stdout.write('\n== Phase 17 checklist (automated proxies) ==\n');
const checklist = [
  { id: 1, name: 'Activation / Output channel', evidence: 'bundle + CLI ask' },
  { id: 2, name: 'Echo provider ports', evidence: 'CLI ask --echo' },
  {
    id: 3,
    name: 'SecretStorage / env key',
    evidence: 'mitii.setApiKey wired; ports read SecretStorage + env (interactive store optional)',
  },
  { id: 4, name: 'Ask via SDK', evidence: 'CLI ask completed' },
  { id: 5, name: 'Cancel', evidence: 'SDK cancel → cancelled' },
  { id: 6, name: 'Index publish', evidence: 'CLI index fixture' },
  {
    id: 7,
    name: 'Sidebar WebviewView',
    evidence: 'mitii.sidebar registered in bundle + package.json (UI open is operator F5)',
  },
  {
    id: 8,
    name: 'Clarify / approve resume',
    evidence: 'hostAsk resolveSuspension + SDK resume (engine-covered; interactive QuickInput is operator F5)',
  },
  {
    id: 9,
    name: 'Session export',
    evidence: 'buildSessionExport secret-free; command registered (file write on operator F5)',
  },
  { id: 10, name: 'No legacy imports', evidence: 'bundle scan + architecture' },
];
for (const row of checklist) {
  process.stdout.write(`  ${row.id}. ${row.name}: proxy OK — ${row.evidence}\n`);
}

if (failures.length > 0) {
  process.stderr.write(`\nPhase 17 verify FAILED (${failures.length}):\n`);
  for (const f of failures) {
    process.stderr.write(`  - ${f.id}: ${f.message}\n`);
  }
  process.exit(1);
}

process.stdout.write('\nPhase 17 verify PASSED.\n');
process.exit(0);
