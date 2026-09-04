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
import { resolveRunAutoOptions } from './commands/runAuto.js';

import { formatSessionHeader } from './banner.js';
import { CLI_HELP } from './help.js';
import { createCliClient, resolveCliPorts } from './ports.js';
import {
  buildSessionExport,
  formatTaskList,
  formatUsageLine,
} from './runReport.js';
import {
  createDefaultSessionIo,
  serializeCliJson,
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
import {
  runAsk,
  resolveAskPrompt,
} from './runAskCommand.js';

import { parseCliArgs } from './parseCliArgs.js';
export { parseCliArgs, type ParsedCliArgs } from './parseCliArgs.js';

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
      `${serializeCliJson({
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
      })}\n`,
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
      `${serializeCliJson({
        latest,
        ...(latest
          ? { capabilitySummary: summarizeRepositoryCapabilities(latest) }
          : {}),
      })}\n`,
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
  loopPolicyJson?: string;
  noLoopPolicy?: boolean;
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
        loopPolicyJson: options.loopPolicyJson,
        noLoopPolicy: options.noLoopPolicy,
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
    case 'ask':
    case 'run': {
      let resolved;
      try {
        if (parsed.command === 'run') {
          const auto = resolveRunAutoOptions({
            auto: parsed.auto === true,
            autonomyPreset: parsed.autonomyPreset,
          });
          if ('error' in auto) {
            sessionIo.writeStderr(`${auto.error}\n\n`);
            sessionIo.writeStdout(CLI_HELP);
            return 2;
          }
          parsed.autonomyPreset = auto.autonomyPreset;
          parsed.autoApproval = auto.autoApproval;
          parsed.origin = auto.origin;
          if (!parsed.mode) {
            parsed.mode = 'agent';
          }
        }
        resolved = resolveAskPrompt(parsed, cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sessionIo.writeStderr(`${message}\n\n`);
        sessionIo.writeStdout(CLI_HELP);
        return 2;
      }
      const { code } = await runAsk({
        prompt: resolved.prompt,
        cwd,
        json: parsed.json === true,
        forceEcho: parsed.forceEcho === true,
        autoClarify: parsed.autoClarify,
        autoApproval: resolved.autoApproval,
        mode: resolved.mode,
        origin: resolved.origin,
        autonomyPreset: resolved.autonomyPreset,
        requiredSkillIds: resolved.requiredSkillIds,
        attachments: resolved.attachments,
        loopPolicyJson: parsed.loopPolicyJson,
        noLoopPolicy: parsed.noLoopPolicy === true,
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
        loopPolicyJson: parsed.loopPolicyJson,
        noLoopPolicy: parsed.noLoopPolicy === true,
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
        loopPolicyJson: parsed.loopPolicyJson,
        noLoopPolicy: parsed.noLoopPolicy === true,
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
    case 'connect': {
      const {
        formatAdapterList,
        runConnectAdapter,
        runStopAllConnectors,
        sessionIoToConnectIo,
      } = await import('./connectors/commands/connect.js');
      const connectIo = sessionIoToConnectIo(sessionIo);
      const rest = [...parsed.rest];
      const stopRequested = rest.includes('--stop');
      const channel = rest.find((arg) => !arg.startsWith('-'));
      const passthrough = channel
        ? rest.filter((arg) => arg !== channel)
        : rest;

      // Merge top-level cwd/mode/echo/approve into channel args when absent.
      const withDefaults = [...passthrough];
      if (parsed.cwd && !withDefaults.includes('--cwd')) {
        withDefaults.push('--cwd', parsed.cwd);
      }
      if (parsed.mode && !withDefaults.includes('--mode')) {
        withDefaults.push('--mode', parsed.mode);
      }
      if (parsed.forceEcho && !withDefaults.includes('--echo')) {
        withDefaults.push('--echo');
      }
      if (
        parsed.autoApproval === 'denied' &&
        !withDefaults.includes('--deny')
      ) {
        withDefaults.push('--deny');
      }
      if (
        parsed.autoApproval === 'approved' &&
        !withDefaults.includes('--approve')
      ) {
        withDefaults.push('--approve');
      }

      if (stopRequested) {
        if (channel) {
          // Channel adapters own stop semantics (e.g. filter by bot username).
          return runConnectAdapter(channel, withDefaults, connectIo);
        }
        return runStopAllConnectors(connectIo);
      }
      if (!channel) {
        sessionIo.writeStdout(`\nAdapters:\n${formatAdapterList()}\n\n`);
        sessionIo.writeStdout(
          "Run 'mitii connect <channel> --help' for channel options.\n",
        );
        return 0;
      }
      return runConnectAdapter(channel, withDefaults, connectIo);
    }
    case 'schedule': {
      const { runScheduleCommand } = await import('./automation/commands.js');
      return runScheduleCommand({
        args: parsed.rest,
        cwd,
        json: parsed.json === true,
        io: sessionIo,
      });
    }
    case 'serve': {
      const { runServeCommand } = await import('./automation/commands.js');
      return runServeCommand({
        args: parsed.rest,
        cwd,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
    }
    case 'events': {
      const { runEventsCommand } = await import('./automation/commands.js');
      return runEventsCommand({
        args: parsed.rest,
        cwd,
        json: parsed.json === true,
        io: sessionIo,
      });
    }
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
