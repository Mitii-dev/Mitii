#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { AuditPackBuilder, verifyAuditPack } from '../core/audit';
import { HeadlessAgentHost, generateHeadlessChangelog, prepareHeadlessRelease } from '../core/headless';
import type { HeadlessRuntime } from '../core/headless/HeadlessConfig';
import type { ProviderType } from '../core/config/schema';

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const cwd = resolve(valueOf(args, '--cwd') ?? process.cwd());
  const since = valueOf(args, '--since');
  const json = args.includes('--json');
  const prompt = positional(args).join(' ').trim();

  if (!command || command === '--help' || command === 'help') {
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
    const host = createHost(cwd, args);
    try {
      const answer = await host.ask(prompt || readStdin());
      process.stdout.write(json ? JSON.stringify({ answer }, null, 2) + '\n' : `${answer}\n`);
      return 0;
    } finally {
      host.dispose();
    }
  }

  if (command === 'plan') {
    const host = createHost(cwd, args);
    try {
      const plan = await host.plan(prompt || readStdin());
      process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
      return 0;
    } finally {
      host.dispose();
    }
  }

  if (command === 'agent') {
    const host = createHost(cwd, args);
    try {
      for await (const event of host.agent(prompt || readStdin())) {
        if (json) {
          process.stdout.write(JSON.stringify(event) + '\n');
        } else if (event.content) {
          process.stdout.write(`${event.content}\n`);
        } else if (event.message) {
          process.stderr.write(`${event.message}\n`);
        }
      }
      return 0;
    } finally {
      host.dispose();
    }
  }

  if (command === 'commit-msg') {
    process.stderr.write(`${command} requires git diff context from the VS Code extension runtime. Use changelog, prepare-release, export-audit, verify-audit, ask, plan, or agent headlessly.\n`);
    return 2;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  printHelp();
  return 1;
}

function createHost(cwd: string, args: string[]): HeadlessAgentHost {
  const provider = (valueOf(args, '--provider') as ProviderType | undefined) ?? 'echo';
  const runtime = (valueOf(args, '--runtime') as HeadlessRuntime | undefined)
    ?? (provider === 'echo' ? 'stub' : 'real');
  return new HeadlessAgentHost({
    cwd,
    runtime,
    providerType: provider,
    baseUrl: valueOf(args, '--base-url'),
    model: valueOf(args, '--model'),
    approval: (valueOf(args, '--approval') as 'auto' | 'manual' | undefined) ?? 'auto',
    enablePuppeteer: args.includes('--enable-puppeteer'),
    allowNetwork: args.includes('--allow-network'),
  });
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
      if (!['--json'].includes(arg)) index += 1;
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
    '  mitii changelog [--since <tag>] [--cwd <path>] [--json]',
    '  mitii prepare-release [--since <tag>] [--cwd <path>] [--json]',
    '  mitii export-audit [--session <jsonl-path>] [--output <zip>] [--cwd <path>] [--json]',
    '  mitii verify-audit <zip> [--cwd <path>] [--json]',
    '  mitii ask "question" [--runtime real|stub] [--provider echo|openai|...] [--model <id>] [--base-url <url>] [--cwd <path>] [--json]',
    '  mitii plan "goal" [--runtime real|stub] [--provider echo|openai|...] [--model <id>] [--approval auto|manual] [--cwd <path>]',
    '  mitii agent "goal" [--runtime real|stub] [--provider echo|openai|...] [--model <id>] [--approval auto|manual] [--enable-puppeteer] [--allow-network] [--json]',
    '',
  ].join('\n'));
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
