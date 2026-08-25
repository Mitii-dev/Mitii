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
 * Current CLI emits one JSON blob ({ result, events }) and uses
 * `ask --mode <mode>` rather than a positional mode command. This adapter
 * indexes the isolated workspace, invokes the CLI, and rewrites output to JSONL.
 *
 * Important: always emit `end` with a synchronous write so a following
 * process.exit() cannot drop the marker when stdout is buffered/large.
 *
 * Usage (placeholders already substituted by the runner):
 *   node mitii-benchmark-agent.mjs --mode <mode> --prompt <prompt> --cwd <workspace> [--echo]
 */
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const mitiiBin = resolve(repoRoot, 'apps/cli/bin/mitii.js');
/** Cap per-line payload so the harness does not drown in nested CLI dumps. */
const MAX_EVENT_LINE_CHARS = 8_000;

const options = parseArgs(process.argv.slice(2));
if (!options.mode || !options.prompt || !options.cwd) {
  process.stderr.write(
    'usage: mitii-benchmark-agent.mjs --mode <mode> --prompt <prompt> --cwd <workspace> [--echo]\n',
  );
  process.exit(2);
}

const index = await runMitii(['index', '--cwd', options.cwd, '--json'], {
  inheritStdout: false,
});
if (index.exitCode !== 0) {
  process.stderr.write(index.stderr || index.stdout || 'mitii index failed\n');
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
  '--json',
  '--approve',
];
if (options.echo) askArgs.push('--echo');

const ask = await runMitii(askArgs, { inheritStdout: false });
emitBenchmarkStdout(ask.stdout);
if (ask.stderr) process.stderr.write(ask.stderr);
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

function runMitii(args, { inheritStdout }) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [mitiiBin, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', inheritStdout ? 'inherit' : 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    if (!inheritStdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
    }
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolvePromise({ exitCode: 1, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.on('close', (code) => {
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

function emitBenchmarkStdout(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    writeJsonLine({ type: 'end', ok: false, reason: 'empty_cli_stdout' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    // Do not dump multi‑tens‑of‑KB truncated CLI blobs into the harness —
    // that used to hide/race the end marker. Keep a compact breadcrumb instead.
    writeJsonLine({
      type: 'cli_json_parse_error',
      bytes: Buffer.byteLength(text, 'utf8'),
      message: error instanceof Error ? error.message : String(error),
    });
    writeJsonLine({ type: 'end', ok: false, reason: 'cli_json_parse_error' });
    return;
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  for (const event of events) {
    if (event && typeof event === 'object') {
      writeJsonLine(event);
    }
  }

  const answer =
    typeof payload.result?.answer === 'string' ? payload.result.answer.trim() : '';
  if (answer) {
    writeJsonLine(answer);
  }

  writeJsonLine({
    type: 'end',
    status: payload.result?.status ?? null,
    route: payload.result?.route ?? null,
    ok: payload.result?.status === 'completed' || payload.result?.status === 'suspended',
  });
}
