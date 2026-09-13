#!/usr/bin/env node
/**
 * Thin adapter between the solid benchmark runner and @mitii/cli.
 *
 * Benchmark cases expect:
 * - exit 0 on success
 * - non-empty stdout
 * - JSONL events including type "end" / "done"
 * - real workspace mutations in agent mode
 *
 * Uses `ask --stream-json` so stage/model events flush live. Buffering the
 * entire `--json` blob meant harness SIGTERM left only `adapter_sigterm` with
 * zero prior telemetry. `plan_ready` is compacted (VS Code sessionLog pattern)
 * so one huge plan object cannot eat the runner's stdout slice.
 *
 * On harness timeout (SIGTERM/SIGINT), emit a best-effort `end` so graders
 * still see structured output even when ask is killed mid-run.
 *
 * Usage (placeholders already substituted by the runner):
 *   node mitii-benchmark-agent.mjs --mode <mode> --prompt <prompt> --cwd <workspace> [--echo]
 */
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const mitiiBin = resolve(
  process.env.MITII_BIN || resolve(repoRoot, 'apps/cli/bin/mitii.js'),
);
/** Cap per-line payload so the harness does not drown in nested CLI dumps. */
const MAX_EVENT_LINE_CHARS = 8_000;

const options = parseArgs(process.argv.slice(2));
if (!options.mode || !options.prompt || !options.cwd) {
  process.stderr.write(
    'usage: mitii-benchmark-agent.mjs --mode <mode> --prompt <prompt> --cwd <workspace> [--echo]\n',
  );
  process.exit(2);
}

/** @type {import('node:child_process').ChildProcess | null} */
let activeChild = null;
let emittedEnd = false;

function emitTimeoutEnd(reason) {
  if (emittedEnd) return;
  emittedEnd = true;
  writeJsonLine({
    type: 'end',
    ok: false,
    status: 'timeout',
    reason,
    usage: null,
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    try {
      if (activeChild?.pid) {
        try {
          process.kill(-activeChild.pid, 'SIGTERM');
        } catch {
          activeChild.kill('SIGTERM');
        }
      }
    } catch {
      // child may already be gone
    }
    emitTimeoutEnd(`adapter_${signal.toLowerCase()}`);
    process.exit(124);
  });
}

writeJsonLine({ type: 'stage_started', stage: 'adapter_index' });
const index = await runMitii(['index', '--cwd', options.cwd, '--json'], {
  onStdoutLine: null,
});
writeJsonLine({
  type: 'stage_completed',
  stage: 'adapter_index',
  exitCode: index.exitCode,
});
if (index.exitCode !== 0) {
  process.stderr.write(index.stderr || index.stdout || 'mitii index failed\n');
  emittedEnd = true;
  writeJsonLine({ type: 'end', ok: false, stage: 'index' });
  process.exit(index.exitCode || 1);
}

const askArgs = [
  'ask',
  options.prompt,
  '--mode',
  options.mode,
  '--cwd',
  options.cwd,
  '--stream-json',
  '--approve',
  // Benchmarks are unattended: suppress interactive clarify in Decision Policy.
  '--origin',
  'automation',
  // Non-interactive: if understanding still soft-asks, proceed as written
  // rather than hanging on a TTY prompt with stdin ignored.
  '--clarify',
  'Proceed with the request as written.',
];
if (options.echo) askArgs.push('--echo');

writeJsonLine({ type: 'stage_started', stage: 'adapter_ask' });
const ask = await runMitii(askArgs, {
  onStdoutLine: handleStreamJsonLine,
});
if (ask.stderr) process.stderr.write(ask.stderr);
writeJsonLine({
  type: 'stage_completed',
  stage: 'adapter_ask',
  exitCode: ask.exitCode,
});

if (!emittedEnd) {
  emittedEnd = true;
  writeJsonLine({
    type: 'end',
    ok: false,
    reason: 'missing_stream_result',
    usage: null,
  });
}

process.exit(ask.exitCode ?? 1);

function parseArgs(argv) {
  const out = { echo: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') out.mode = argv[++i];
    else if (arg === '--prompt') out.prompt = argv[++i];
    else if (arg === '--cwd') out.cwd = argv[++i];
    else if (arg === '--echo') out.echo = true;
  }
  return out;
}

/**
 * @param {string[]} args
 * @param {{ onStdoutLine: ((line: string) => void) | null }} opts
 */
function runMitii(args, { onStdoutLine }) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [mitiiBin, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    activeChild = child;
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (!onStdoutLine) return;
      lineBuffer += text;
      let newline;
      while ((newline = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, newline);
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line.trim()) onStdoutLine(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      activeChild = null;
      if (onStdoutLine && lineBuffer.trim()) onStdoutLine(lineBuffer);
      resolvePromise({ exitCode: 1, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.on('close', (code) => {
      activeChild = null;
      if (onStdoutLine && lineBuffer.trim()) onStdoutLine(lineBuffer);
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Synchronous stdout write so process.exit cannot drop the trailing end event.
 */
function writeJsonLine(value) {
  const line =
    typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const clipped =
    line.length > MAX_EVENT_LINE_CHARS
      ? `${line.slice(0, MAX_EVENT_LINE_CHARS)}…[truncated ${line.length} chars]`
      : line;
  writeSync(1, `${clipped}\n`);
}

/**
 * Flatten CLI `--stream-json` envelopes into benchmark JSONL events.
 * @param {string} rawLine
 */
function handleStreamJsonLine(rawLine) {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith('{')) return;
  let envelope;
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    writeJsonLine({
      type: 'cli_json_parse_error',
      message: 'stream-json line parse failed',
      bytes: Buffer.byteLength(trimmed, 'utf8'),
    });
    return;
  }

  if (envelope?.type === 'event' && envelope.event && typeof envelope.event === 'object') {
    writeJsonLine(compactRunEvent(envelope.event));
    return;
  }

  if (envelope?.type === 'result' && envelope.result && typeof envelope.result === 'object') {
    const result = envelope.result;
    const answer =
      typeof result.answer === 'string' ? result.answer.trim() : '';
    if (answer) writeJsonLine(answer);
    emittedEnd = true;
    writeJsonLine({
      type: 'end',
      status: result.status ?? null,
      route: result.route ?? null,
      ok: result.status === 'completed' || result.status === 'suspended',
      usage: result.usage ?? null,
      durationMs: result.durationMs ?? null,
    });
  }
}

/**
 * Drop bulky nested payloads that blow the runner's 8KB stdout window.
 * Mirrors apps/vscode/src/sessionLog.ts plan_ready compaction.
 * @param {Record<string, unknown>} event
 */
function compactRunEvent(event) {
  if (event.type !== 'plan_ready') return event;
  const plan = event.plan && typeof event.plan === 'object' ? event.plan : null;
  const phases = Array.isArray(plan?.phases) ? plan.phases : [];
  const stepCount = phases.reduce(
    (sum, phase) =>
      sum + (Array.isArray(phase?.steps) ? phase.steps.length : 0),
    0,
  );
  return {
    type: event.type,
    runId: event.runId,
    at: event.at,
    planningDepth: event.planningDepth,
    phaseCount: event.phaseCount,
    approvalRequired: event.approvalRequired,
    ...(plan
      ? {
          objective: plan.objective,
          stepCount,
        }
      : {}),
  };
}
