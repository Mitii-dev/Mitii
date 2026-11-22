import type {
  AgentMode,
  MitiiAutonomyPreset,
  MitiiClient,
  MitiiConversationMessage,
  MitiiImageAttachment,
  TaskList,
  UserRequestOrigin,
} from '@mitii/sdk';
import {
  buildWritingRecipeAsk,
  formatEnvironmentDetailsBlock,
  HostStartOptionsError,
  loadWorkspaceHooks,
  mapUiModeToAgentMode,
  prepareStartInput,
  resolveMitiiWritingRecipe,
} from '@mitii/host';

import {
  composeAgentPrompt,
  loadAgentFile,
  loadImageAttachment,
  loadPromptFile,
  type MitiiAgentFile,
} from './agentFile.js';
import { createCliClient, type CliRuntime } from './ports.js';
import {
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
import { loadMitiiHostConfig } from './config.js';
import { resolveCliLoopPolicyThresholds } from './loopPolicy.js';
import { resolveRunWallTimeMs } from './runTimeout.js';
import {
  persistLatestRepositoryState,
} from './stateCache.js';
import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';
import { resolveCliSemanticIndexSettings } from './semanticIndex.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';
import type { ParsedCliArgs } from './parseCliArgs/index.js';
import {
  isCliSessionLogEnabled,
  newCliThreadSessionId,
  resolveCliLogsDir,
} from './cliLog.js';

export function resolveAskPrompt(
  parsed: ParsedCliArgs,
  cwd: string,
): {
  prompt: string;
  mode?: AgentMode | 'database';
  origin?: UserRequestOrigin;
  autonomyPreset?: MitiiAutonomyPreset;
  autoApproval?: 'approved' | 'denied';
  requiredSkillIds?: string[];
  attachments?: MitiiImageAttachment[];
  profile?: string;
} {
  let agent: MitiiAgentFile | undefined;
  if (parsed.agent) {
    agent = loadAgentFile(parsed.agent, cwd);
  }
  let promptFileText: string | undefined;
  if (parsed.promptFile) {
    promptFileText = loadPromptFile(parsed.promptFile);
  }
  const prompt = composeAgentPrompt({
    cliPrompt: parsed.prompt,
    promptFileText,
    agent,
  });
  const requiredSkillIds = [
    ...(parsed.skills ?? []),
    ...(agent?.requiredSkillIds ?? []),
  ];
  const attachments = (parsed.images ?? []).map((imagePath) =>
    loadImageAttachment(imagePath, cwd),
  );
  const autonomyPreset = parsed.autonomyPreset ?? agent?.autonomyPreset;
  const mode = parsed.mode ?? agent?.mode;
  const origin =
    parsed.origin ??
    agent?.origin ??
    (autonomyPreset && autonomyPreset !== 'readonly'
      ? 'automation'
      : undefined);
  let autoApproval = parsed.autoApproval;
  if (
    !autoApproval &&
    (autonomyPreset === 'apply' || autonomyPreset === 'apply_and_pr')
  ) {
    autoApproval = 'approved';
  }
  return {
    prompt,
    mode,
    origin,
    autonomyPreset,
    autoApproval,
    ...(parsed.profile ? { profile: parsed.profile } : {}),
    ...(requiredSkillIds.length > 0 ? { requiredSkillIds } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

/**
 * Like resolveAskPrompt, but applies writing recipes (git context + force skill).
 */
export async function resolveAskPromptWithRecipe(
  parsed: ParsedCliArgs,
  cwd: string,
): Promise<{
  prompt: string;
  mode?: AgentMode;
  origin?: UserRequestOrigin;
  autonomyPreset?: MitiiAutonomyPreset;
  autoApproval?: 'approved' | 'denied';
  requiredSkillIds?: string[];
  attachments?: MitiiImageAttachment[];
  profile?: string;
}> {
  if (!parsed.recipe) {
    return resolveAskPrompt(parsed, cwd);
  }
  const recipe = resolveMitiiWritingRecipe(parsed.recipe);
  if (!recipe) {
    throw new Error(
      `mitii: unknown --recipe "${parsed.recipe}" (use commit-message, pr-summary, or changelog)`,
    );
  }

  let agent: MitiiAgentFile | undefined;
  if (parsed.agent) {
    agent = loadAgentFile(parsed.agent, cwd);
  }
  let promptFileText: string | undefined;
  if (parsed.promptFile) {
    promptFileText = loadPromptFile(parsed.promptFile);
  }
  const userNoteParts = [
    parsed.prompt?.trim(),
    promptFileText?.trim(),
    agent?.prompt?.trim(),
  ].filter((part): part is string => Boolean(part));
  const userNote = userNoteParts.join('\n\n') || undefined;

  const ask = await buildWritingRecipeAsk({
    workspaceRoot: cwd,
    recipe: recipe.id,
    userNote,
  });

  const autonomyPreset = parsed.autonomyPreset ?? agent?.autonomyPreset;
  const mode = parsed.mode ?? agent?.mode ?? ask.mode;
  const origin =
    parsed.origin ??
    agent?.origin ??
    (autonomyPreset && autonomyPreset !== 'readonly'
      ? 'automation'
      : undefined);
  let autoApproval = parsed.autoApproval;
  if (
    !autoApproval &&
    (autonomyPreset === 'apply' || autonomyPreset === 'apply_and_pr')
  ) {
    autoApproval = 'approved';
  }

  const requiredSkillIds = [
    ...ask.requiredSkillIds,
    ...(parsed.skills ?? []),
    ...(agent?.requiredSkillIds ?? []),
  ]
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, 3);

  const attachments = (parsed.images ?? []).map((imagePath) =>
    loadImageAttachment(imagePath, cwd),
  );

  return {
    prompt: ask.prompt,
    mode,
    origin,
    autonomyPreset,
    autoApproval,
    requiredSkillIds,
    ...(parsed.profile ? { profile: parsed.profile } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

export async function ensurePublishedRepositoryState(options: {
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

function reportOutcome(
  io: SessionIo,
  machineReadable: boolean,
  outcome: Awaited<ReturnType<typeof driveRun>>,
): void {
  if (machineReadable) return;
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

export async function runAsk(options: {
  prompt: string;
  cwd: string;
  json: boolean;
  streamJson?: boolean;
  forceEcho: boolean;
  autoClarify?: string;
  autoApproval?: 'approved' | 'denied';
  mode?: AgentMode | 'database';
  origin?: UserRequestOrigin;
  autonomyPreset?: MitiiAutonomyPreset;
  /** One-off profile slug; overrides `.mitii/modes.json` active for this run. */
  profile?: string;
  requiredSkillIds?: string[];
  attachments?: MitiiImageAttachment[];
  conversation?: MitiiConversationMessage[];
  taskList?: TaskList;
  /** Stable thread id for interactive session log continuity. */
  sessionId?: string;
  loopPolicyJson?: string;
  noLoopPolicy?: boolean;
  /** Host wall-time budget (seconds); falls back to MITII_RUN_TIMEOUT_SECONDS. */
  timeoutSeconds?: number;
  io?: SessionIo;
  /**
   * Pre-built client for interactive sessions. When set, no new client (and no
   * fresh in-memory repository state / MCP sync) is created for this turn.
   */
  runtime?: CliRuntime;
}): Promise<{
  code: number;
  mode: AgentMode;
  outcome?: Awaited<ReturnType<typeof driveRun>>;
}> {
  const { client, ports, memoryCapture } =
    options.runtime ??
    (await createCliClient({
      cwd: options.cwd,
      forceEcho: options.forceEcho,
    }));
  const io = options.io ?? createDefaultSessionIo();
  const uiMode = options.mode ?? ports.defaultMode;
  const origin = options.origin ?? 'user';
  const machineReadable =
    options.json === true || options.streamJson === true;
  const threadSessionId = options.sessionId ?? newCliThreadSessionId();
  const runCaps = ports.runLlm.capabilities;
  const fullSessionLog = isCliSessionLogEnabled()
    ? {
        workspaceRoot: options.cwd,
        logsDir: resolveCliLogsDir(options.cwd),
        sessionId: threadSessionId,
        contextWindowTokens: runCaps.contextWindowTokens,
        maximumOutputTokens: runCaps.maximumOutputTokens,
      }
    : undefined;
  if (!machineReadable) {
    io.writeStderr(
      `[mitii] provider=${ports.providerLabel} mode=${uiMode} origin=${origin}${
        options.profile ? ` profile=${options.profile}` : ''
      }\n`,
    );
  }

  // Each one-shot CLI invocation uses a fresh in-memory repository-state store.
  // Index in a prior process only writes `.mitii/` on disk; ask must publish
  // into this process or agent runs fail with state_unavailable. A reused
  // session runtime already holds the published state, so this is a no-op then.
  await ensurePublishedRepositoryState({
    client,
    workspaceId: ports.workspaceId,
    cwd: options.cwd,
    io,
  });

  const hooksEnabled =
    process.env.MITII_HOOKS === '1' || process.env.MITII_HOOKS === 'true';
  const hooks = await loadWorkspaceHooks({
    workspaceRoot: options.cwd,
    enabled: hooksEnabled,
  });
  const hooksSafety =
    hooks.denyTools.length > 0 || hooks.denyCommandPrefixes.length > 0
      ? {
          enabled: true as const,
          denyTools: hooks.denyTools,
          denyCommandPrefixes: hooks.denyCommandPrefixes,
          denyPathScopes: [] as string[],
          denyNetworkHosts: [] as string[],
          protectedPathGlobs: [] as string[],
        }
      : undefined;

  const runTimeout = resolveRunWallTimeMs({
    flagSeconds: options.timeoutSeconds,
    env: process.env,
  });
  if (!runTimeout.ok) {
    io.writeStderr(`${runTimeout.message}\n`);
    return { code: 2, mode: mapUiModeToAgentMode(uiMode) };
  }

  const hostConfig = loadMitiiHostConfig(options.cwd);
  let loopPolicyThresholds;
  try {
    loopPolicyThresholds = resolveCliLoopPolicyThresholds({
      config: hostConfig.loopPolicy,
      flagJson: options.loopPolicyJson,
      disabled: options.noLoopPolicy === true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.writeStderr(`${message}\n`);
    return { code: 2, mode: mapUiModeToAgentMode(uiMode) };
  }
  if (loopPolicyThresholds && !options.json) {
    io.writeStderr(
      `[mitii] loopPolicy lab overrides active (${Object.keys(loopPolicyThresholds).join(', ')})\n`,
    );
  }

  // `--approve` is the headless host policy: skip plan-gate suspension and
  // mutation approval prompts (same shape as VS Code "pilot"). `--deny` only
  // answers resume prompts; it does not suppress gates on start.
  // Autonomy apply* presets also set never/never via SDK mapping.
  const approvalOverride =
    options.autoApproval === 'approved'
      ? ({
          approvalMode: 'never' as const,
          planApproval: 'never' as const,
        })
      : undefined;

  // Unattended / headless runs: turn on DecisionBrief + mutation critic so
  // multi-clause asks and path-scope discipline are enforced without a human.
  const unattendedSteering =
    options.autoApproval === 'approved' || origin === 'automation'
      ? ({
          decisionBrief: true,
          criticMode: 'enforce' as const,
          policyFactsFirst: true,
        })
      : undefined;

  let prepared;
  try {
    prepared = await prepareStartInput({
      prompt: options.prompt,
      workspaceRoot: options.cwd,
      uiMode,
      origin,
      sessionId: threadSessionId,
      userSafety: 'disk',
      ...(options.profile ? { profileOverride: options.profile } : {}),
      ...(options.requiredSkillIds && options.requiredSkillIds.length > 0
        ? { requiredSkillIds: options.requiredSkillIds }
        : {}),
      ...(options.autonomyPreset
        ? { autonomyPreset: options.autonomyPreset }
        : {}),
      ...(approvalOverride ? { approvalOverride } : {}),
      ...(hooksSafety ? { extraUserSafetyRules: hooksSafety } : {}),
      ...(unattendedSteering ? { steering: unattendedSteering } : {}),
      ...(options.attachments && options.attachments.length > 0
        ? { attachments: [...options.attachments] }
        : {}),
      ...(options.conversation && options.conversation.length > 0
        ? { conversation: options.conversation }
        : {}),
      ...(loopPolicyThresholds
        ? { loopPolicy: { thresholds: loopPolicyThresholds } }
        : {}),
      ...(runTimeout.maxWallTimeMs !== undefined
        ? { maxWallTimeMs: runTimeout.maxWallTimeMs }
        : {}),
    });
  } catch (error) {
    if (
      error instanceof HostStartOptionsError &&
      error.code === 'unknown_mode_profile'
    ) {
      io.writeStderr(
        `mitii: unknown --profile "${options.profile}". Run: mitii profile list\n`,
      );
      return { code: 2, mode: mapUiModeToAgentMode(uiMode) };
    }
    throw error;
  }

  const effectiveMode = prepared.effectiveMode;
  const modeReminder = prepared.meta.usedDatabaseOverlay
    ? `Database (${effectiveMode})`
    : prepared.meta.usedModeProfileName
      ? `${prepared.meta.usedModeProfileName} (${effectiveMode})`
      : effectiveMode;
  const environmentBlock = formatEnvironmentDetailsBlock({
    todayDate: new Date().toLocaleDateString('en-CA'),
    modeReminder,
  });
  const start = {
    ...prepared.start,
    ...(environmentBlock
      ? {
          environment: [
            environmentBlock,
            ...(prepared.start.environment ?? []),
          ],
        }
      : {}),
    ...(effectiveMode !== 'ask' && options.taskList
      ? { taskList: options.taskList }
      : {}),
  };

  const outcome = await driveRun({
    client,
    start,
    json: options.json,
    streamJson: options.streamJson === true,
    autoClarify: options.autoClarify,
    autoApproval: options.autoApproval,
    io,
    memoryCapture,
    ...(fullSessionLog ? { sessionLog: fullSessionLog } : {}),
  });
  reportOutcome(io, machineReadable, outcome);
  return { code: outcome.exitCode, mode: effectiveMode, outcome };
}

