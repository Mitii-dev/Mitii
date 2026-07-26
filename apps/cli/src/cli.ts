import { createMitiiClient } from '@mitii/sdk';
import type { AgentRunResult, RunEvent } from '@mitii/sdk';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_HELP } from './help.js';
import { resolveCliPorts } from './ports.js';

export interface ParsedCliArgs {
  command: 'help' | 'version' | 'ask' | 'unknown';
  prompt?: string;
  cwd?: string;
  json?: boolean;
  forceEcho?: boolean;
  unknownCommand?: string;
  rest: string[];
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = argv.slice(2);
  const flags = new Set<string>();
  const positionals: string[] = [];
  let cwd: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      return { command: 'help', rest: [] };
    }
    if (arg === '--cwd') {
      cwd = args[++i];
      continue;
    }
    if (arg === '--json') {
      flags.add('json');
      continue;
    }
    if (arg === '--echo') {
      flags.add('echo');
      continue;
    }
    if (arg.startsWith('-')) {
      // Unknown flags are ignored for smoke surface; keep argv simple.
      continue;
    }
    positionals.push(arg);
  }

  const [command = 'help', ...rest] = positionals;
  if (command === 'help') return { command: 'help', rest: [] };
  if (command === 'version') return { command: 'version', rest: [] };
  if (command === 'ask') {
    const prompt = rest.join(' ').trim();
    return {
      command: 'ask',
      prompt: prompt.length > 0 ? prompt : undefined,
      cwd,
      json: flags.has('json'),
      forceEcho: flags.has('echo'),
      rest,
    };
  }

  return {
    command: 'unknown',
    unknownCommand: command,
    rest,
  };
}

function readPackageVersion(): string {
  try {
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../package.json',
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function runAsk(options: {
  prompt: string;
  cwd: string;
  json: boolean;
  forceEcho: boolean;
}): Promise<number> {
  const ports = resolveCliPorts({ forceEcho: options.forceEcho });
  const client = createMitiiClient({
    understandingLlm: ports.understandingLlm,
    runLlm: ports.runLlm,
    workspaceRoot: options.cwd,
    defaultMode: 'ask',
    defaultSessionId: 'cli_session',
    workspaceId: 'cli_workspace',
  });

  const run = client.start({
    prompt: options.prompt,
    mode: 'ask',
    workspaceRoot: options.cwd,
  });

  if (!options.json) {
    process.stderr.write(`[mitii] provider=${ports.providerLabel}\n`);
  }

  const events: RunEvent[] = [];
  for await (const event of run.events) {
    events.push(event);
    if (
      !options.json &&
      event.type === 'model_delta' &&
      typeof event.preview === 'string' &&
      event.preview.length > 0
    ) {
      process.stdout.write(event.preview);
    }
  }

  const result: AgentRunResult = await run.result;
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ result, events }, null, 2)}\n`);
  } else {
    if (result.answer && !events.some((e) => e.type === 'model_delta')) {
      process.stdout.write(`${result.answer}\n`);
    } else if (result.answer) {
      process.stdout.write('\n');
    }
    process.stderr.write(
      `[mitii] status=${result.status} route=${result.route ?? 'n/a'}\n`,
    );
  }

  if (result.status === 'completed' || result.status === 'suspended') {
    return 0;
  }
  return 1;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const parsed = parseCliArgs(argv);

  switch (parsed.command) {
    case 'help':
      process.stdout.write(CLI_HELP);
      return 0;
    case 'version':
      process.stdout.write(`${readPackageVersion()}\n`);
      return 0;
    case 'ask': {
      if (!parsed.prompt) {
        process.stderr.write('mitii ask: missing prompt\n\n');
        process.stdout.write(CLI_HELP);
        return 2;
      }
      return runAsk({
        prompt: parsed.prompt,
        cwd: parsed.cwd ?? process.cwd(),
        json: parsed.json === true,
        forceEcho: parsed.forceEcho === true,
      });
    }
    case 'unknown':
      process.stderr.write(
        `mitii: unknown command "${parsed.unknownCommand ?? ''}"\n\n`,
      );
      process.stdout.write(CLI_HELP);
      return 2;
    default:
      process.stdout.write(CLI_HELP);
      return 0;
  }
}
