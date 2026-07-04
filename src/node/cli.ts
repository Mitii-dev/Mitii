#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { AuditPackBuilder, verifyAuditPack } from '../core/audit';
import { generateHeadlessChangelog, prepareHeadlessRelease } from '../core/headless';
import type { HeadlessRuntime } from '../core/headless/HeadlessConfig';
import type { ProviderType } from '../core/config/schema';
import { createClient, query } from '../../packages/sdk/src';
import type { MitiiMode, MitiiEvent } from '../../packages/sdk/src';
import { connectAgentMemoryMcp } from '../core/mcp/mcpWorkspaceConfig';
import { AutoMemoryFileWriter } from '../core/memory/AutoMemoryFileWriter';

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const cwd = resolve(valueOf(args, '--cwd') ?? process.cwd());
  const since = valueOf(args, '--since');
  const json = args.includes('--json');
  const prompt = positional(args).join(' ').trim();

  if (!command) {
    if (process.stdin.isTTY) return interactive(cwd, args);
    printHelp();
    return 0;
  }

  if (command === '-i' || command === '--interactive') {
    return interactive(cwd, args, prompt || valueOf(args, '-i') || valueOf(args, '--interactive'));
  }

  if (command === '--help' || command === 'help') {
    printHelp();
    return 0;
  }

  if (command === 'changelog') {
    const changelog = await generateHeadlessChangelog(cwd, since);
    process.stdout.write(json ? JSON.stringify({ changelog }, null, 2) + '\n' : changelog);
    return 0;
  }

  if (command === 'prepare-release') {
    const result = await prepareHeadlessRelease(cwd, since);
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : result.releaseNotes);
    return 0;
  }

  if (command === 'export-audit') {
    const session = valueOf(args, '--session');
    const output = valueOf(args, '--output') ?? join(cwd, `.mitii/audit/mitii-audit-${Date.now()}.zip`);
    const logPath = session && existsSync(session) ? session : latestSessionLog(cwd);
    const pack = new AuditPackBuilder().build({
      sessionId: session ?? 'headless',
      workspace: cwd,
      extensionVersion: readPackageVersion(cwd),
      logPath,
      summaryMarkdown: logPath ? `# Mitii audit export\n\nLog: ${logPath}\n` : '# Mitii audit export\n\nNo session log found.\n',
    });
    writeFileSync(output, pack.buffer);
    process.stdout.write(json ? JSON.stringify({ output, entries: pack.entries }, null, 2) + '\n' : `${output}\n`);
    return 0;
  }

  if (command === 'verify-audit') {
    const target = positional(args)[0];
    if (!target) {
      process.stderr.write('verify-audit requires a zip path.\n');
      return 2;
    }
    const result = verifyAuditPack(readFileSync(resolve(cwd, target)), process.env.MITII_AUDIT_SIGNING_KEY);
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : formatAuditVerification(result));
    return result.ok ? 0 : 1;
  }

  if (command === 'ask') {
    return runOneShot('ask', cwd, args, prompt || readStdin(), json);
  }

  if (command === 'plan') {
    return runOneShot('plan', cwd, args, prompt || readStdin(), json);
  }

  if (command === 'agent') {
    return runOneShot((valueOf(args, '--mode') as MitiiMode | undefined) ?? 'agent', cwd, args, prompt || readStdin(), json);
  }

  if (command === 'init') {
    return initProjectInstructions(cwd, args, json);
  }

  if (command === 'auth') {
    return authCommand(args, json);
  }

  if (command === 'memory') {
    return memoryCommand(cwd, args, json);
  }

  if (command === 'commit-msg') {
    process.stderr.write(`${command} requires git diff context from the VS Code extension runtime. Use changelog, prepare-release, export-audit, verify-audit, ask, plan, or agent headlessly.\n`);
    return 2;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  printHelp();
  return 1;
}

async function runOneShot(mode: MitiiMode, cwd: string, args: string[], prompt: string, json: boolean): Promise<number> {
  const clientOptions = clientOptionsFromArgs(cwd, args);
  if (mode === 'ask' && !json) {
    const client = createClient(clientOptions);
    try {
      process.stdout.write(`${await client.ask(prompt)}\n`);
      return 0;
    } finally {
      client.dispose();
    }
  }
  if (mode === 'plan' && !json) {
    const client = createClient(clientOptions);
    try {
      process.stdout.write(`${JSON.stringify(await client.plan(prompt), null, 2)}\n`);
      return 0;
    } finally {
      client.dispose();
    }
  }

  for await (const event of query({ ...clientOptions, mode, prompt, sessionId: valueOf(args, '--session-id') })) {
    if (json) {
      process.stdout.write(JSON.stringify(event) + '\n');
    } else {
      renderCliEvent(event);
    }
  }
  return 0;
}

function clientOptionsFromArgs(cwd: string, args: string[]) {
  const saved = loadDefaultCredentials();
  const provider = (valueOf(args, '--provider') as ProviderType | undefined) ?? saved.provider ?? 'echo';
  const runtime = (valueOf(args, '--runtime') as HeadlessRuntime | undefined)
    ?? (provider === 'echo' ? 'stub' : 'real');
  return {
    cwd,
    runtime,
    provider,
    baseUrl: valueOf(args, '--base-url') ?? saved.baseUrl,
    model: valueOf(args, '--model') ?? saved.model,
    apiKey: valueOf(args, '--api-key') ?? saved.apiKey,
    approval: (valueOf(args, '--approval') as 'auto' | 'manual' | undefined) ?? 'auto',
    enablePuppeteer: args.includes('--enable-puppeteer'),
    allowNetwork: args.includes('--allow-network'),
    vectors: args.includes('--vectors'),
  };
}

function renderCliEvent(event: MitiiEvent): void {
  if (event.type === 'assistant_delta') process.stdout.write(event.content);
  if (event.type === 'reasoning_delta') process.stderr.write(event.content);
  if (event.type === 'tool_start') process.stderr.write(`\n[tool] ${event.tool}\n`);
  if (event.type === 'approval_required') process.stderr.write(`\n[approval required] ${event.tool}: ${event.message ?? event.id}\n`);
  if (event.type === 'error') process.stderr.write(`\n[error] ${event.message}\n`);
  if (event.type === 'done') process.stdout.write(event.content.endsWith('\n') ? '' : '\n');
}

async function interactive(cwd: string, args: string[], initialPrompt = ''): Promise<number> {
  const rl = createInterface({ input, output });
  let mode: MitiiMode = (valueOf(args, '--mode') as MitiiMode | undefined) ?? 'agent';
  process.stdout.write(`Mitii interactive (${mode}) | ${cwd}\n`);
  process.stdout.write('Slash commands: /ask /plan /agent /review /exit\n\n');
  try {
    let nextPrompt = initialPrompt;
    while (true) {
      const line = nextPrompt || await rl.question(`${mode}> `);
      nextPrompt = '';
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === '/exit' || trimmed === '/quit') break;
      if (['/ask', '/plan', '/agent', '/review'].includes(trimmed)) {
        mode = trimmed.slice(1) as MitiiMode;
        continue;
      }
      await runOneShot(mode, cwd, args, trimmed, false);
    }
    return 0;
  } finally {
    rl.close();
  }
}

async function initProjectInstructions(cwd: string, args: string[], json: boolean): Promise<number> {
  const local = args.includes('--local');
  const force = args.includes('--force');
  const target = join(cwd, local ? '.mitii/MITTII.local.md' : 'MITII.md');
  if (existsSync(target) && !force) {
    const message = `${target} already exists. Re-run with --force to overwrite.`;
    process.stderr.write(`${message}\n`);
    return 2;
  }
  mkdirSync(dirname(target), { recursive: true });
  const template = buildInstructionsTemplate(cwd);
  writeFileSync(target, template, 'utf-8');
  process.stdout.write(json ? JSON.stringify({ path: target }) + '\n' : `Created ${target}\n`);
  return 0;
}

function buildInstructionsTemplate(cwd: string): string {
  const pkgPath = join(cwd, 'package.json');
  let scripts: Record<string, string> = {};
  if (existsSync(pkgPath)) {
    try {
      scripts = JSON.parse(readFileSync(pkgPath, 'utf-8')).scripts ?? {};
    } catch {
      scripts = {};
    }
  }
  const scriptLines = Object.entries(scripts)
    .filter(([name]) => /^(build|test|lint|typecheck|compile|smoke)/.test(name))
    .map(([name, command]) => `- ${name}: \`${command}\``);
  return [
    '# MITTII.md',
    '',
    '## Project Commands',
    scriptLines.length ? scriptLines.join('\n') : '- Add build, test, and lint commands here.',
    '',
    '## Architecture Notes',
    '- Describe key packages, runtime boundaries, and important data flows.',
    '',
    '## Conventions',
    '- Keep changes scoped and run the most relevant verification before finishing.',
    '',
    '## Safety',
    '- Do not commit secrets. Prefer local-first tooling unless the task explicitly needs network access.',
    '',
  ].join('\n');
}

async function authCommand(args: string[], json: boolean): Promise<number> {
  const sub = args[0];
  if (sub === 'list' || sub === 'show') {
    const saved = loadDefaultCredentials();
    const shown = { ...saved, apiKey: saved.apiKey ? maskSecret(saved.apiKey) : undefined };
    process.stdout.write(JSON.stringify(shown, null, 2) + '\n');
    return 0;
  }
  const provider = valueOf(args, '--provider');
  const apiKey = valueOf(args, '--apikey') ?? valueOf(args, '--api-key');
  const model = valueOf(args, '--model');
  const baseUrl = valueOf(args, '--base-url');

  if (provider || apiKey || model || baseUrl) {
    saveDefaultCredentials({ provider: provider as ProviderType | undefined, apiKey, model, baseUrl });
    process.stdout.write(json ? JSON.stringify({ saved: true }) + '\n' : 'Saved credentials to ~/.mitii/credentials.json\n');
    return 0;
  }

  const rl = createInterface({ input, output });
  try {
    saveDefaultCredentials({
      provider: (await rl.question('Provider: ')) as ProviderType,
      baseUrl: await rl.question('Base URL: '),
      model: await rl.question('Model: '),
      apiKey: await rl.question('API key: '),
    });
    process.stdout.write('Saved credentials to ~/.mitii/credentials.json\n');
    return 0;
  } finally {
    rl.close();
  }
}

function memoryCommand(cwd: string, args: string[], json: boolean): number {
  const sub = args[0];
  if (sub === 'connect' && args[1] === 'agentmemory') {
    const servers = connectAgentMemoryMcp(cwd);
    process.stdout.write(json ? JSON.stringify({ agentmemory: servers.agentmemory }, null, 2) + '\n' : 'Connected agentmemory MCP in .mitii/mcp.json\n');
    return 0;
  }
  if (sub === 'status') {
    const writer = new AutoMemoryFileWriter(cwd, { scope: 'both' });
    const recent = writer.readRecent(20);
    process.stdout.write(json ? JSON.stringify({ recentCount: recent.length, recent }, null, 2) + '\n' : `Auto-memory files: ${recent.length}\n`);
    return 0;
  }
  if (sub === 'prune') {
    const days = Number(valueOf(args, '--days') ?? 30);
    const removed = new AutoMemoryFileWriter(cwd, { scope: 'both' }).prune(Number.isFinite(days) ? days : 30);
    process.stdout.write(json ? JSON.stringify({ removed }) + '\n' : `Removed ${removed} auto-memory files.\n`);
    return 0;
  }
  process.stderr.write('Usage: mitii memory status|prune|connect agentmemory\n');
  return 2;
}

function valueOf(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (!['--json', '--enable-puppeteer', '--allow-network', '--vectors', '--force', '--local'].includes(arg)) index += 1;
      continue;
    }
    if (arg === '-i') {
      index += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

function latestSessionLog(cwd: string): string | undefined {
  const dir = join(cwd, '.mitii', 'logs');
  if (!existsSync(dir)) return undefined;
  const fs = require('fs') as typeof import('fs');
  const files = fs.readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort();
  const last = files[files.length - 1];
  return last ? join(dir, last) : undefined;
}

function readPackageVersion(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp(): void {
  process.stdout.write([
    'Mitii CLI',
    '',
    'Commands:',
    '  mitii [--mode ask|plan|agent|review]      Start interactive terminal session',
    '  mitii -i "prompt"                         Start interactive session with an initial prompt',
    '  mitii init [--local] [--force] [--cwd <path>] [--json]',
    '  mitii auth [--provider <id> --base-url <url> --model <id> --apikey <key>]',
    '  mitii auth list',
    '  mitii memory status|prune|connect agentmemory [--cwd <path>] [--json]',
    '  mitii changelog [--since <tag>] [--cwd <path>] [--json]',
    '  mitii prepare-release [--since <tag>] [--cwd <path>] [--json]',
    '  mitii export-audit [--session <jsonl-path>] [--output <zip>] [--cwd <path>] [--json]',
    '  mitii verify-audit <zip> [--cwd <path>] [--json]',
    '  mitii ask "question" [--runtime real|stub] [--provider echo|openai|...] [--model <id>] [--base-url <url>] [--cwd <path>] [--json]',
    '  mitii plan "goal" [--runtime real|stub] [--provider echo|openai|...] [--model <id>] [--approval auto|manual] [--cwd <path>]',
    '  mitii agent "goal" [--mode ask|plan|agent|review] [--runtime real|stub] [--provider echo|openai|...] [--model <id>] [--approval auto|manual] [--enable-puppeteer] [--allow-network] [--vectors] [--json]',
    '',
  ].join('\n'));
}

type SavedCredentials = {
  provider?: ProviderType;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

function credentialsPath(): string {
  return join(homedir(), '.mitii', 'credentials.json');
}

function loadDefaultCredentials(): SavedCredentials {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(), 'utf-8')) as SavedCredentials;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDefaultCredentials(next: SavedCredentials): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  const merged = { ...loadDefaultCredentials(), ...compact(next) };
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on filesystems that do not support chmod.
  }
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' ? v.trim().length > 0 : v !== undefined)) as Partial<T>;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatAuditVerification(result: ReturnType<typeof verifyAuditPack>): string {
  if (result.ok) {
    return `Audit pack verified (${result.entries.length} entries).\n`;
  }
  return `Audit pack verification failed:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`;
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
