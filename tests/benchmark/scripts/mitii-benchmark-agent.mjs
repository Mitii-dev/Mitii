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
 * Current CLI emits one pretty-printed JSON blob ({ result, events }) and uses
 * `ask --mode <mode>` rather than a positional mode command. This adapter
 * indexes the isolated workspace, invokes the CLI, and rewrites output to JSONL.
 *
 * Usage (placeholders already substituted by the runner):
 *   node mitii-benchmark-agent.mjs --mode <mode> --prompt <prompt> --cwd <workspace> [--echo]
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const mitiiBin = resolve(repoRoot, 'apps/cli/bin/mitii.js');

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

function emitBenchmarkStdout(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    process.stdout.write(`${JSON.stringify({ type: 'end', ok: false })}\n`);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    // Non-JSON CLI output: pass through and still emit end for the verifier.
    process.stdout.write(`${text}\n`);
    process.stdout.write(`${JSON.stringify({ type: 'end' })}\n`);
    return;
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  for (const event of events) {
    if (event && typeof event === 'object') {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
  }

  const answer =
    typeof payload.result?.answer === 'string' ? payload.result.answer.trim() : '';
  if (answer) {
    process.stdout.write(`${answer}\n`);
  }

  process.stdout.write(
    `${JSON.stringify({
      type: 'end',
      result: payload.result ?? null,
      status: payload.result?.status ?? null,
    })}\n`,
  );
}
