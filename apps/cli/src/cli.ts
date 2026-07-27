import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

import { CLI_HELP } from './help.js';
import { createCliClient } from './ports.js';
import {
  buildSessionExport,
  formatContextInspection,
  formatDiffReview,
  formatUsageLine,
} from './runReport.js';
import {
  createDefaultSessionIo,
  driveRun,
  type SessionIo,
} from './session.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';
import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';
import {
  loadPersistedRepositoryState,
  persistLatestRepositoryState,
} from './stateCache.js';

export interface ParsedCliArgs {
  command:
    | 'help'
    | 'version'
    | 'ask'
    | 'index'
    | 'status'
    | 'export-session'
    | 'session'
    | 'unknown';
  prompt?: string;
  cwd?: string;
  json?: boolean;
  forceEcho?: boolean;
  autoClarify?: string;
  autoApproval?: 'approved' | 'denied';
  exportPath?: string;
  unknownCommand?: string;
  rest: string[];
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = argv.slice(2);
  const flags = new Set<string>();
  const positionals: string[] = [];
  let cwd: string | undefined;
  let autoClarify: string | undefined;
  let autoApproval: 'approved' | 'denied' | undefined;
  let exportPath: string | undefined;

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
    if (arg === '--clarify') {
      autoClarify = args[++i];
      continue;
    }
    if (arg === '--approve') {
      autoApproval = 'approved';
      continue;
    }
    if (arg === '--deny') {
      autoApproval = 'denied';
      continue;
    }
    if (arg === '--out') {
      exportPath = args[++i];
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    positionals.push(arg);
  }

  const [command = 'help', ...rest] = positionals;
  if (command === 'help') return { command: 'help', rest: [] };
  if (command === 'version') return { command: 'version', rest: [] };
  if (command === 'index' || command === 'status' || command === 'session') {
    return {
      command,
      cwd,
      json: flags.has('json'),
      forceEcho: flags.has('echo'),
      rest,
    };
  }
  if (command === 'export-session') {
    return {
      command: 'export-session',
      prompt: rest.join(' ').trim() || undefined,
      cwd,
      json: true,
      forceEcho: flags.has('echo'),
      exportPath,
      rest,
    };
  }
  if (command === 'ask') {
    const prompt = rest.join(' ').trim();
    return {
      command: 'ask',
      prompt: prompt.length > 0 ? prompt : undefined,
      cwd,
      json: flags.has('json'),
      forceEcho: flags.has('echo'),
      autoClarify,
      autoApproval,
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

function reportOutcome(
  io: SessionIo,
  json: boolean,
  outcome: Awaited<ReturnType<typeof driveRun>>,
): void {
  if (json) return;
  for (const line of formatContextInspection(outcome.events)) {
    io.writeStderr(`${line}\n`);
  }
  for (const line of formatDiffReview(outcome.result)) {
    io.writeStderr(`${line}\n`);
  }
  io.writeStderr(`${formatUsageLine(outcome.result)}\n`);
}

async function runAsk(options: {
  prompt: string;
  cwd: string;
  json: boolean;
  forceEcho: boolean;
  autoClarify?: string;
  autoApproval?: 'approved' | 'denied';
  io?: SessionIo;
}): Promise<{ code: number; outcome?: Awaited<ReturnType<typeof driveRun>> }> {
  const { client, ports } = createCliClient({
    cwd: options.cwd,
    forceEcho: options.forceEcho,
  });
  const io = options.io ?? createDefaultSessionIo();
  if (!options.json) {
    io.writeStderr(`[mitii] provider=${ports.providerLabel}\n`);
  }

  const outcome = await driveRun({
    client,
    start: {
      prompt: options.prompt,
      mode: ports.defaultMode,
      workspaceRoot: options.cwd,
    },
    json: options.json,
    autoClarify: options.autoClarify,
    autoApproval: options.autoApproval,
    io,
  });
  reportOutcome(io, options.json, outcome);
  return { code: outcome.exitCode, outcome };
}

async function runIndex(options: {
  cwd: string;
  json: boolean;
  forceEcho: boolean;
  io: SessionIo;
}): Promise<number> {
  const { client, ports } = createCliClient({
    cwd: options.cwd,
    forceEcho: options.forceEcho,
  });
  let fileCount = 0;
  let truncated = false;
  let indexMode: 'full' | 'host_snapshot' = 'full';
  let databasePath: string | undefined;
  let published;
  try {
    const full = await runFullWorkspaceIndex({
      cwd: options.cwd,
      workspaceId: ports.workspaceId,
    });
    fileCount = full.fileCount;
    truncated = full.truncated;
    databasePath = full.databasePath;
    published = await client.publishRepositoryStateFromIndexing(full.indexing);
  } catch (error) {
    indexMode = 'host_snapshot';
    const errorDetail =
      process.env.MITII_DEBUG_INDEX === '1' && error instanceof Error
        ? (error.stack ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error);
    options.io.writeStderr(
      `[mitii] full index unavailable; falling back to host snapshot: ${errorDetail}\n`,
    );
    const snapshot = await buildWorkspaceSnapshot({
      workspaceRoot: options.cwd,
      workspaceId: ports.workspaceId,
    });
    fileCount = snapshot.fileCount;
    truncated = snapshot.truncated;
    published = await client.publishRepositoryState(snapshot.candidate);
  }
  if (published.status === 'published') {
    persistLatestRepositoryState(options.cwd, published.descriptor);
  }
  if (options.json) {
    options.io.writeStdout(
      `${JSON.stringify(
        {
          published,
          fileCount,
          truncated,
          indexMode,
          ...(databasePath ? { databasePath } : {}),
        },
        null,
        2,
      )}\n`,
    );
  } else if (published.status === 'published') {
    options.io.writeStdout(
      `indexed workspaceId=${published.reference.workspaceId} stateToken=${published.reference.stateToken.slice(0, 16)}… readiness=${published.descriptor.readiness} files=${fileCount}${truncated ? ' (truncated)' : ''} mode=${indexMode}\n`,
    );
    for (const reason of published.descriptor.reasons) {
      options.io.writeStderr(`[mitii] ${reason.code}: ${reason.message}\n`);
    }
  } else {
    options.io.writeStderr(
      `[mitii] index failed: ${published.status} ${'message' in published ? published.message : ''}\n`,
    );
    return 1;
  }
  return published.status === 'published' ? 0 : 1;
}

async function runStatus(options: {
  cwd: string;
  json: boolean;
  forceEcho: boolean;
  io: SessionIo;
}): Promise<number> {
  const { client, ports } = createCliClient({
    cwd: options.cwd,
    forceEcho: options.forceEcho,
  });
  const latest =
    (await client.getLatestRepositoryState(ports.workspaceId)) ??
    loadPersistedRepositoryState(options.cwd);
  if (options.json) {
    options.io.writeStdout(`${JSON.stringify({ latest }, null, 2)}\n`);
    return latest ? 0 : 1;
  }
  if (!latest) {
    options.io.writeStderr(
      '[mitii] no published repository state — run `mitii index` first\n',
    );
    return 1;
  }
  options.io.writeStdout(
    `status workspaceId=${latest.workspaceId} readiness=${latest.readiness} scan=${latest.scanCompleteness} stateToken=${latest.stateToken.slice(0, 16)}…\n`,
  );
  for (const reason of latest.reasons) {
    options.io.writeStderr(`[mitii] ${reason.code}: ${reason.message}\n`);
  }
  return 0;
}

async function runSession(options: {
  cwd: string;
  forceEcho: boolean;
  io: SessionIo;
}): Promise<number> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const ask = (q: string) =>
    new Promise<string>((resolve) => {
      rl.question(q, (answer) => resolve(answer));
    });

  options.io.writeStderr(
    '[mitii] interactive session — empty line or Ctrl-D to exit; Ctrl-C cancels a run\n',
  );
  try {
    for (;;) {
      const prompt = (await ask('mitii> ')).trim();
      if (!prompt) break;
      const { code } = await runAsk({
        prompt,
        cwd: options.cwd,
        json: false,
        forceEcho: options.forceEcho,
        io: options.io,
      });
      if (code === 130) {
        options.io.writeStderr('[mitii] run cancelled\n');
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}

export async function main(
  argv: string[] = process.argv,
  io?: SessionIo,
): Promise<number> {
  const parsed = parseCliArgs(argv);
  const sessionIo = io ?? createDefaultSessionIo();
  const cwd = parsed.cwd ?? process.cwd();

  switch (parsed.command) {
    case 'help':
      sessionIo.writeStdout(CLI_HELP);
      return 0;
    case 'version':
      sessionIo.writeStdout(`${readPackageVersion()}\n`);
      return 0;
    case 'ask': {
      if (!parsed.prompt) {
        sessionIo.writeStderr('mitii ask: missing prompt\n\n');
        sessionIo.writeStdout(CLI_HELP);
        return 2;
      }
      const { code } = await runAsk({
        prompt: parsed.prompt,
        cwd,
        json: parsed.json === true,
        forceEcho: parsed.forceEcho === true,
        autoClarify: parsed.autoClarify,
        autoApproval: parsed.autoApproval,
        io: sessionIo,
      });
      return code;
    }
    case 'index':
      return runIndex({
        cwd,
        json: parsed.json === true,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
    case 'status':
      return runStatus({
        cwd,
        json: parsed.json === true,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
    case 'export-session': {
      if (!parsed.prompt) {
        sessionIo.writeStderr('mitii export-session: missing prompt\n');
        return 2;
      }
      const { code, outcome } = await runAsk({
        prompt: parsed.prompt,
        cwd,
        json: true,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
      if (outcome && parsed.exportPath) {
        const payload = buildSessionExport({
          result: outcome.result,
          events: outcome.events,
        });
        writeFileSync(parsed.exportPath, `${JSON.stringify(payload, null, 2)}\n`);
        sessionIo.writeStderr(`[mitii] wrote ${parsed.exportPath}\n`);
      }
      return code;
    }
    case 'session':
      return runSession({
        cwd,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
    case 'unknown':
      sessionIo.writeStderr(
        `mitii: unknown command "${parsed.unknownCommand ?? ''}"\n\n`,
      );
      sessionIo.writeStdout(CLI_HELP);
      return 2;
    default:
      sessionIo.writeStdout(CLI_HELP);
      return 0;
  }
}
