import type {
  AgentMode,
  MitiiAutonomyPreset,
  MitiiClient,
  MitiiConversationMessage,
  TaskList,
  UserRequestOrigin,
} from '@mitii/sdk';
import { loadProjectRules, loadUserSafetyRules } from '@mitii/host';

import {
  composeAgentPrompt,
  loadAgentFile,
  loadPromptFile,
  type MitiiAgentFile,
} from './agentFile.js';
import { createCliClient } from './ports.js';
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
import {
  persistLatestRepositoryState,
} from './stateCache.js';
import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';
import { resolveCliSemanticIndexSettings } from './semanticIndex.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';
import type { ParsedCliArgs } from './parseCliArgs.js';

export function resolveAskPrompt(
  parsed: ParsedCliArgs,
  cwd: string,
): {
  prompt: string;
  mode?: AgentMode;
  origin?: UserRequestOrigin;
  autonomyPreset?: MitiiAutonomyPreset;
  autoApproval?: 'approved' | 'denied';
  requiredSkillIds?: string[];
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
    ...(requiredSkillIds.length > 0 ? { requiredSkillIds } : {}),
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

export async function runAsk(options: {
  prompt: string;
  cwd: string;
  json: boolean;
  forceEcho: boolean;
  autoClarify?: string;
  autoApproval?: 'approved' | 'denied';
  mode?: AgentMode;
  origin?: UserRequestOrigin;
  autonomyPreset?: MitiiAutonomyPreset;
  requiredSkillIds?: string[];
  conversation?: MitiiConversationMessage[];
  taskList?: TaskList;
  loopPolicyJson?: string;
  noLoopPolicy?: boolean;
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
  const origin = options.origin ?? 'user';
  if (!options.json) {
    io.writeStderr(
      `[mitii] provider=${ports.providerLabel} mode=${mode} origin=${origin}\n`,
    );
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
  const userSafetyRules = loadUserSafetyRules(options.cwd);
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
    return { code: 2, mode };
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
  const hostApproval =
    options.autoApproval === 'approved'
      ? ({ approvalMode: 'never' as const, planApproval: 'never' as const })
      : {};

  const outcome = await driveRun({
    client,
    start: {
      prompt: options.prompt,
      mode,
      origin,
      ...(options.autonomyPreset
        ? { autonomyPreset: options.autonomyPreset }
        : {}),
      workspaceRoot: options.cwd,
      ...hostApproval,
      ...(userSafetyRules.enabled ? { userSafetyRules } : {}),
      ...(projectRules.length > 0 ? { projectRules: [...projectRules] } : {}),
      ...(options.requiredSkillIds && options.requiredSkillIds.length > 0
        ? { requiredSkillIds: [...options.requiredSkillIds] }
        : {}),
      ...(options.conversation && options.conversation.length > 0
        ? { conversation: options.conversation }
        : {}),
      ...(mode !== 'ask' && options.taskList
        ? { taskList: options.taskList }
        : {}),
      ...(loopPolicyThresholds
        ? { loopPolicy: { thresholds: loopPolicyThresholds } }
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

