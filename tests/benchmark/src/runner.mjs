import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runProcess, substitute } from './process.mjs';
import { snapshotTree } from './snapshot.mjs';
import { verifyCheck } from './verifiers.mjs';

/** In-repo case workspaces (gitignored): tests/benchmark/.workspaces/<runId>/ */
export function defaultWorkRoot(rootDir, runId) {
  return join(rootDir, '.workspaces', runId);
}

export async function runCases(cases, rootDir, config, options = {}) {
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const workRoot = options.workRoot ?? defaultWorkRoot(rootDir, runId);
  mkdirSync(workRoot, { recursive: true });
  const results = new Array(cases.length);
  let next = 0;

  async function worker() {
    while (next < cases.length) {
      const index = next;
      next += 1;
      results[index] = await runOneCase(cases[index], index, cases.length, rootDir, workRoot, config, options);
      options.onResult?.(results[index], index, cases.length);
    }
  }

  const concurrency = Math.max(1, options.concurrency ?? config.run.concurrency ?? 1);
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, () => worker()));
  if (!(options.keepWorkspaces ?? config.run.keepWorkspaces)) rmSync(workRoot, { recursive: true, force: true });
  return results;
}

async function runOneCase(testCase, index, total, rootDir, workRoot, config, options) {
  const workspace = join(workRoot, testCase.id);
  cpSync(join(rootDir, 'fixtures', testCase.fixture), workspace, {
    recursive: true,
    filter: (source) => !shouldIgnore(source, config.run.ignoreChanges ?? []),
  });
  linkFixtureDependencies(join(rootDir, 'fixtures', testCase.fixture), workspace);
  const before = snapshotTree(workspace, config.run.ignoreChanges);
  const preconditions = [];
  for (const check of testCase.preconditions ?? []) {
    preconditions.push(await verifyCheck(check, {
      output: '',
      agentExitCode: 0,
      workspace,
      before,
      after: before,
    }));
  }
  if (preconditions.some((check) => !check.passed)) {
    return baseResult(testCase, {
      passed: false,
      error: 'Fixture precondition failed',
      preconditions,
      checks: [],
      durationMs: 0,
      exitCode: null,
      stdout: '',
      stderr: '',
      workspace: options.keepWorkspaces ? workspace : null,
    });
  }

  const variables = {
    mode: testCase.mode,
    prompt: testCase.prompt,
    workspace,
    id: testCase.id,
    fixture: testCase.fixture,
  };
  const command = substitute(config.agent.command, variables);
  const args = (config.agent.args ?? []).map((arg) => substitute(arg, variables));
  const agentCwd = config.agent.cwd
    ? resolve(dirname(options.configPath), substitute(config.agent.cwd, variables))
    : rootDir;
  const execution = await runProcess({
    command,
    args,
    cwd: agentCwd,
    env: Object.fromEntries(Object.entries(config.agent.env ?? {}).map(([key, value]) => [key, substitute(value, variables)])),
    timeoutMs: testCase.timeoutMs ?? config.agent.timeoutMs,
  });
  const output = execution.stdout;
  const after = snapshotTree(workspace, config.run.ignoreChanges);
  const checks = [];
  for (const check of testCase.checks) {
    checks.push(await verifyCheck(check, {
      output,
      agentExitCode: execution.exitCode,
      workspace,
      before,
      after,
    }));
  }
  const usage = extractUsage(execution.stdout);
  return baseResult(testCase, {
    passed: !execution.timedOut && checks.every((check) => check.passed),
    error: execution.timedOut ? 'Agent timed out' : null,
    preconditions,
    checks,
    durationMs: execution.durationMs,
    usage,
    exitCode: execution.exitCode,
    stdout: execution.stdout.slice(0, 8000),
    stderr: execution.stderr.slice(0, 4000),
    workspace: options.keepWorkspaces ? workspace : null,
  });
}

/** Pull usage from the JSONL `end` event emitted by mitii-benchmark-agent. */
export function extractUsage(stdout) {
  const empty = {
    modelCalls: null,
    toolCalls: null,
    loopIterations: null,
    inputTokens: null,
    outputTokens: null,
  };
  if (!stdout) return empty;
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event?.type !== 'end') continue;
      const usage = event.usage && typeof event.usage === 'object' ? event.usage : {};
      return {
        modelCalls: numberOrNull(usage.modelCalls),
        toolCalls: numberOrNull(usage.toolCalls),
        loopIterations: numberOrNull(usage.loopIterations),
        inputTokens: numberOrNull(usage.inputTokens),
        outputTokens: numberOrNull(usage.outputTokens),
        agentDurationMs: numberOrNull(event.durationMs),
      };
    } catch {
      // ignore non-JSON lines
    }
  }
  return empty;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function baseResult(testCase, run) {
  return {
    id: testCase.id,
    familyId: testCase.familyId,
    variant: testCase.variant,
    suite: testCase.suite ?? null,
    category: testCase.category ?? null,
    difficulty: testCase.difficulty,
    mode: testCase.mode,
    capability: testCase.capability,
    fixture: testCase.fixture,
    prompt: testCase.prompt,
    ...run,
  };
}

function shouldIgnore(source, ignoredNames) {
  const normalized = source.replaceAll('\\', '/');
  return ignoredNames.some((name) => normalized.split('/').includes(name));
}

function linkFixtureDependencies(sourceRoot, workspaceRoot) {
  function visit(directory) {
    for (const entry of readdirSync(directory)) {
      const source = join(directory, entry);
      if (!statSync(source).isDirectory()) continue;
      if (entry === 'node_modules') {
        const destination = join(workspaceRoot, relative(sourceRoot, source));
        if (!existsSync(destination)) {
          mkdirSync(dirname(destination), { recursive: true });
          symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
        }
      } else if (!['.git', '.mitii', 'dist', '.next', 'coverage'].includes(entry)) {
        visit(source);
      }
    }
  }
  visit(sourceRoot);
}
