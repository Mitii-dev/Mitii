import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

import type {
  AgentMode,
  MitiiClient,
  MitiiConversationMessage,
  TaskList,
} from '@mitii/sdk';
import { loadProjectRules } from '@mitii/host';

import { formatSessionHeader } from './banner.js';
import { CLI_HELP } from './help.js';
import { createCliClient, resolveCliPorts } from './ports.js';
import {
  buildSessionExport,
  formatContextInspection,
  formatDiffReview,
  formatTaskList,
  formatUsageLine,
} from './runReport.js';
import {
  createDefaultSessionIo,
  driveRun,
  type SessionIo,
} from './session.js';
import { nextCliSessionCarry } from './sessionCarry.js';
import { runSetup } from './setup.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';
import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';
import { loadMitiiHostConfig } from './config.js';
import { resolveCliSemanticIndexSettings } from './semanticIndex.js';
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
    | 'setup'
    | 'unknown'
    | 'error';
  prompt?: string;
  cwd?: string;
  json?: boolean;
  forceEcho?: boolean;
  autoClarify?: string;
  autoApproval?: 'approved' | 'denied';
  exportPath?: string;
  mode?: AgentMode;
  unknownCommand?: string;
  errorMessage?: string;
  setupProvider?: string;
  setupModel?: string;
  setupBaseUrl?: string;
  setupGlobal?: boolean;
  setupShow?: boolean;
  setupTest?: boolean;
  setupYes?: boolean;
  rest: string[];
}

function takeValue(
  args: string[],
  index: number,
  flag: string,
): { value: string; next: number } | { error: string } {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    return { error: `mitii: ${flag} requires a value` };
  }
  return { value, next: index + 1 };
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = argv.slice(2);
  const flags = new Set<string>();
  const positionals: string[] = [];
  let cwd: string | undefined;
  let autoClarify: string | undefined;
  let autoApproval: 'approved' | 'denied' | undefined;
  let exportPath: string | undefined;
  let mode: AgentMode | undefined;
  let setupProvider: string | undefined;
  let setupModel: string | undefined;
  let setupBaseUrl: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      return { command: 'help', rest: [] };
    }
    if (arg === '--version' || arg === '-v') {
      return { command: 'version', rest: [] };
    }
    if (arg === '--cwd') {
      const taken = takeValue(args, i, '--cwd');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      cwd = taken.value;
      i = taken.next;
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
      const taken = takeValue(args, i, '--clarify');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      autoClarify = taken.value;
      i = taken.next;
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
      const taken = takeValue(args, i, '--out');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      exportPath = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--mode') {
      const taken = takeValue(args, i, '--mode');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      if (taken.value === 'ask' || taken.value === 'plan' || taken.value === 'agent') {
        mode = taken.value;
      } else {
        return {
          command: 'error',
          errorMessage: `mitii: --mode must be ask, plan, or agent (got "${taken.value}")`,
          rest: [],
        };
      }
      i = taken.next;
      continue;
    }
    if (arg === '--provider') {
      const taken = takeValue(args, i, '--provider');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      setupProvider = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--model') {
      const taken = takeValue(args, i, '--model');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      setupModel = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--base-url') {
      const taken = takeValue(args, i, '--base-url');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      setupBaseUrl = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--global') {
      flags.add('global');
      continue;
    }
    if (arg === '--show') {
      flags.add('show');
      continue;
    }
    if (arg === '--test') {
      flags.add('test');
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      flags.add('yes');
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        command: 'error',
        errorMessage: `mitii: unknown option "${arg}"\nTry "mitii --help" for usage.`,
        rest: [],
      };
    }
    positionals.push(arg);
  }

  const [command = 'help', ...rest] = positionals;
  if (command === 'help') return { command: 'help', rest: [] };
  if (command === 'version') return { command: 'version', rest: [] };
  if (command === 'setup') {
    return {
      command: 'setup',
      cwd,
      mode,
      setupProvider,
      setupModel,
      setupBaseUrl,
      setupGlobal: flags.has('global'),
      setupShow: flags.has('show'),
      setupTest: flags.has('test'),
      setupYes: flags.has('yes'),
      rest,
    };
  }
  if (command === 'index' || command === 'status' || command === 'session') {
    return {
      command,
      cwd,
      json: flags.has('json'),
      forceEcho: flags.has('echo'),
      mode,
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
      mode,
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
      mode,
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

type RepositoryCapabilitySummary = Array<{
  rootId: string;
  capability: string;
  status: string;
  reasonCode?: string;
  revision?: string;
  profile?: string;
}>;

interface RepositoryCapabilitySnapshot {
  capability: string;
  status: string;
  reasonCode?: string;
}

interface RepositoryRootSnapshot {
  rootId: string;
  projectCatalogRevision: string;
  codeIndexRevision?: string;
  textIndexRevision?: string;
  vectorProfile?: string;
  vectorIndexRevision?: string;
  graphRevision?: string;
  mapRevision?: string;
  capabilities: RepositoryCapabilitySnapshot[];
}

interface RepositoryDescriptorSnapshot {
  workspaceId: string;
  stateToken: string;
  readiness: string;
  scanCompleteness: string;
  cleanupAllowed: boolean;
  generatedAt: string;
  roots: RepositoryRootSnapshot[];
}

interface IndexingDiagnostics {
  status: string;
  cleanupAllowed: boolean;
  statistics: unknown;
  warnings: unknown[];
  rootResults: unknown[];
  incompleteFiles: Array<{
    path: string;
    status: string;
    analysisStatus?: string;
    chunkingStatus?: string;
    codeIndexStatus?: string;
    textIndexStatus?: string;
    warnings: unknown[];
  }>;
}

interface IndexingFileResultSnapshot {
  relativePath: string;
  status: string;
  analysisStatus?: string;
  chunkingStatus?: string;
  codeIndexStatus?: string;
  textIndexStatus?: string;
  warnings: unknown[];
}

function capabilityRevision(
  root: RepositoryRootSnapshot,
  capability: string,
): string | undefined {
  switch (capability) {
    case 'codeIndex':
      return root.codeIndexRevision;
    case 'textIndex':
      return root.textIndexRevision;
    case 'vectorIndex':
      return root.vectorIndexRevision;
    case 'graph':
      return root.graphRevision;
    case 'map':
      return root.mapRevision;
    case 'catalog':
      return root.projectCatalogRevision;
    default:
      return undefined;
  }
}

function summarizeRepositoryCapabilities(
  descriptor: RepositoryDescriptorSnapshot,
): RepositoryCapabilitySummary {
  return descriptor.roots.flatMap((root) =>
    root.capabilities.map((entry) => ({
      rootId: root.rootId,
      capability: entry.capability,
      status: entry.status,
      reasonCode: entry.reasonCode,
      revision: capabilityRevision(root, entry.capability),
      profile: entry.capability === 'vectorIndex' ? root.vectorProfile : undefined,
    })),
  );
}

function writeRepositoryCapabilityLines(
  io: SessionIo,
  descriptor: RepositoryDescriptorSnapshot,
): void {
  for (const capability of summarizeRepositoryCapabilities(descriptor)) {
    const suffix = [
      capability.revision ? `revision=${capability.revision}` : undefined,
      capability.profile ? `profile=${capability.profile}` : undefined,
      capability.reasonCode ? `reason=${capability.reasonCode}` : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    io.writeStdout(
      `capability root=${capability.rootId} ${capability.capability}=${capability.status}${suffix ? ` ${suffix}` : ''}\n`,
    );
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
  if (outcome.result.taskList) {
    for (const line of formatTaskList(outcome.result.taskList)) {
      io.writeStderr(`${line}\n`);
    }
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
  mode?: AgentMode;
  conversation?: MitiiConversationMessage[];
  taskList?: TaskList;
  io?: SessionIo;
}): Promise<{
  code: number;
  mode: AgentMode;
  outcome?: Awaited<ReturnType<typeof driveRun>>;
}> {
  const { client, ports, memoryCapture } = createCliClient({
    cwd: options.cwd,
    forceEcho: options.forceEcho,
  });
  const io = options.io ?? createDefaultSessionIo();
  const mode = options.mode ?? ports.defaultMode;
  if (!options.json) {
    io.writeStderr(`[mitii] provider=${ports.providerLabel} mode=${mode}\n`);
  }

  // Each CLI invocation uses a fresh in-memory repository-state store.
  // Index in a prior process only writes `.mitii/` on disk; ask must publish
  // into this process or agent runs fail with state_unavailable.
  await ensurePublishedRepositoryState({
    client,
    workspaceId: ports.workspaceId,
    cwd: options.cwd,
    io,
  });

  const projectRules = await loadProjectRules({
    workspaceRoot: options.cwd,
  });
  const outcome = await driveRun({
    client,
    start: {
      prompt: options.prompt,
      mode,
      workspaceRoot: options.cwd,
      ...(projectRules.length > 0 ? { projectRules: [...projectRules] } : {}),
      ...(options.conversation && options.conversation.length > 0
        ? { conversation: options.conversation }
        : {}),
      ...(mode !== 'ask' && options.taskList
        ? { taskList: options.taskList }
        : {}),
    },
    json: options.json,
    autoClarify: options.autoClarify,
    autoApproval: options.autoApproval,
    io,
    memoryCapture,
  });
  reportOutcome(io, options.json, outcome);
  return { code: outcome.exitCode, mode, outcome };
}

async function ensurePublishedRepositoryState(options: {
  client: MitiiClient;
  workspaceId: string;
  cwd: string;
  io: SessionIo;
}): Promise<void> {
  if (await options.client.getLatestRepositoryState(options.workspaceId)) {
    return;
  }

  try {
    const config = loadMitiiHostConfig(options.cwd);
    const full = await runFullWorkspaceIndex({
      cwd: options.cwd,
      workspaceId: options.workspaceId,
      force: true,
      semanticIndex: resolveCliSemanticIndexSettings({
        env: process.env,
        config,
      }),
    });
    const published = await options.client.publishRepositoryStateFromIndexing(
      full.indexing,
      {
        catalogRevisionByRoot: full.catalogRevisionByRoot,
        graphRevisionByRoot: full.graphRevisionByRoot,
        mapRevisionByRoot: full.mapRevisionByRoot,
      },
    );
    if (published.status === 'published') {
      persistLatestRepositoryState(options.cwd, published.descriptor);
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error);
    options.io.writeStderr(
      `[mitii] auto-index for ask falling back to host snapshot: ${detail}\n`,
    );
    const snapshot = await buildWorkspaceSnapshot({
      workspaceRoot: options.cwd,
      workspaceId: options.workspaceId,
    });
    const published = await options.client.publishRepositoryState(
      snapshot.candidate,
    );
    if (published.status === 'published') {
      persistLatestRepositoryState(options.cwd, published.descriptor);
    }
  }
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
  let vectorIndex: Awaited<
    ReturnType<typeof runFullWorkspaceIndex>
  >['vectorIndex'] | undefined;
  let indexingDiagnostics: IndexingDiagnostics | undefined;
  let published;
  try {
    const config = loadMitiiHostConfig(options.cwd);
    const full = await runFullWorkspaceIndex({
      cwd: options.cwd,
      workspaceId: ports.workspaceId,
      force: true,
      semanticIndex: resolveCliSemanticIndexSettings({
        env: process.env,
        config,
      }),
    });
    fileCount = full.fileCount;
    truncated = full.truncated;
    databasePath = full.databasePath;
    vectorIndex = full.vectorIndex;
    const fileResults =
      full.indexing.fileResults as IndexingFileResultSnapshot[];
    indexingDiagnostics = {
      status: full.indexing.status,
      cleanupAllowed: full.indexing.cleanupAllowed,
      statistics: full.indexing.statistics,
      warnings: full.indexing.warnings,
      rootResults: full.indexing.rootResults,
      incompleteFiles: fileResults
        .filter((result) => result.status !== 'complete')
        .map((result) => ({
          path: result.relativePath,
          status: result.status,
          analysisStatus: result.analysisStatus,
          chunkingStatus: result.chunkingStatus,
          codeIndexStatus: result.codeIndexStatus,
          textIndexStatus: result.textIndexStatus,
          warnings: result.warnings,
        })),
    };
    published = await client.publishRepositoryStateFromIndexing(full.indexing, {
      catalogRevisionByRoot: full.catalogRevisionByRoot,
      graphRevisionByRoot: full.graphRevisionByRoot,
      mapRevisionByRoot: full.mapRevisionByRoot,
    });
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
          ...(indexingDiagnostics ? { indexing: indexingDiagnostics } : {}),
          ...(published.status === 'published'
            ? {
                capabilitySummary: summarizeRepositoryCapabilities(
                  published.descriptor,
                ),
              }
            : {}),
          ...(databasePath ? { databasePath } : {}),
          ...(vectorIndex ? { vectorIndex } : {}),
        },
        null,
        2,
      )}\n`,
    );
  } else if (published.status === 'published') {
    options.io.writeStdout(
      `indexed workspaceId=${published.reference.workspaceId} stateToken=${published.reference.stateToken.slice(0, 16)}… readiness=${published.descriptor.readiness} files=${fileCount}${truncated ? ' (truncated)' : ''} mode=${indexMode}\n`,
    );
    if (vectorIndex) {
      options.io.writeStdout(
        `vectorIndex=${vectorIndex.status}${vectorIndex.profileId ? ` profile=${vectorIndex.profileId}` : ''}${vectorIndex.reason ? ` reason=${vectorIndex.reason}` : ''}\n`,
      );
    }
    writeRepositoryCapabilityLines(options.io, published.descriptor);
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
    options.io.writeStdout(
      `${JSON.stringify(
        {
          latest,
          ...(latest
            ? { capabilitySummary: summarizeRepositoryCapabilities(latest) }
            : {}),
        },
        null,
        2,
      )}\n`,
    );
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
  writeRepositoryCapabilityLines(options.io, latest);
  for (const reason of latest.reasons) {
    options.io.writeStderr(`[mitii] ${reason.code}: ${reason.message}\n`);
  }
  return 0;
}

async function runSession(options: {
  cwd: string;
  forceEcho: boolean;
  mode?: AgentMode;
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

  const ports = resolveCliPorts({
    cwd: options.cwd,
    forceEcho: options.forceEcho,
  });
  const mode = options.mode ?? ports.defaultMode;
  const config = loadMitiiHostConfig(options.cwd);
  const hasConfiguredProvider =
    (Boolean(config.provider) && config.provider !== 'echo') ||
    (Boolean(config.providerPreset) && config.providerPreset !== 'echo');
  options.io.writeStderr(
    formatSessionHeader({
      cwd: options.cwd,
      providerLabel: ports.providerLabel,
      mode,
      version: readPackageVersion(),
      isEcho: ports.providerLabel === 'echo' || options.forceEcho,
      showSetupHint:
        ports.providerLabel === 'echo' &&
        !options.forceEcho &&
        !hasConfiguredProvider,
    }),
  );

  let conversation: MitiiConversationMessage[] = [];
  let taskList: TaskList | undefined;
  try {
    for (;;) {
      const prompt = (await ask('mitii> ')).trim();
      if (!prompt) break;
      const { code, mode: runMode, outcome } = await runAsk({
        prompt,
        cwd: options.cwd,
        json: false,
        forceEcho: options.forceEcho,
        mode: options.mode,
        conversation,
        taskList,
        io: options.io,
      });
      if (outcome) {
        const next = nextCliSessionCarry({
          mode: runMode,
          conversation,
          taskList,
          prompt,
          result: outcome.result,
        });
        conversation = next.conversation;
        taskList = next.taskList;
      }
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
        mode: parsed.mode,
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
        mode: parsed.mode,
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
        mode: parsed.mode,
        io: sessionIo,
      });
    case 'setup':
      return runSetup({
        cwd,
        global: parsed.setupGlobal === true,
        show: parsed.setupShow === true,
        provider: parsed.setupProvider,
        model: parsed.setupModel,
        baseUrl: parsed.setupBaseUrl,
        mode: parsed.mode,
        test: parsed.setupTest === true,
        yes: parsed.setupYes === true,
        io: sessionIo,
      });
    case 'error':
      sessionIo.writeStderr(`${parsed.errorMessage ?? 'mitii: invalid arguments'}\n`);
      return 2;
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
