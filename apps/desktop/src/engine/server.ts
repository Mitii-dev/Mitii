/**
 * Local HTTP engine for Mitii Desktop.
 * Agent authority stays in MitiiClient (host-injected); this is transport only.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  createFileSystemSkillsCatalog,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  clearWorkspaceMemories,
  commitWorkspaceMemory,
  deleteWorkspaceMemory,
  listProviderModels,
  listWorkspaceMemoriesForView,
  normalizeOllamaModelId,
  pullOllamaModel,
  resolveIndexConcurrency,
  testProviderConnection,
  type SemanticIndexSettings,
} from '@mitii/host';
import {
  AGENT_ENGINE_SCHEMA_VERSION,
  planArtifactSchema,
  planStrategyDecisionSchema,
  taskListSchema,
  type MitiiClient,
  type MitiiResumeInput,
  type MitiiStartInput,
} from '@mitii/sdk';
import {
  compileRecipeToStartInput,
} from '@mitii/host';
import {
  defaultNewRecipeDraft,
  defaultNewSkillDraft,
  listMcpServers,
  listRecipes,
  listWorkspaceSkills,
  loadDesktopRecipeSpec,
  readWorkspaceSkill,
  setMcpMasterEnabled,
  setMcpServerEnabled,
  addCustomMcpServer,
  deleteMcpServer,
  installBuiltinMcpServer,
  deleteWorkspaceSkill,
  writeRecipe,
  writeWorkspaceSkill,
  writeWorkspaceSkillMarkdown,
} from './extensions.js';
import {
  createWorkspaceWatcher,
  type WorkspaceChangeEvent,
} from './explorer/workspaceWatch.js';
import { startIncrementalWorkspaceIndex } from './explorer/incrementalIndex.js';
import {
  formatSkillFrontmatterWithAi,
  requireActiveDesktopProfile,
} from './skills/formatFrontmatter.js';
import { getSharedMcpManager } from '@mitii/mcp';
import { persistExcalidrawFromToolResult } from './excalidrawArtifacts.js';

import {
  MITII_DESKTOP_PROTOCOL,
  MITII_DESKTOP_PROTOCOL_VERSION,
  createPromptId,
  parseDesktopPromptBody,
  type DesktopHostMode,
  type DesktopPromptStreamLine,
} from '../shared/protocol.js';
import { generateEngineToken } from '../shared/engine-token.js';
import { isAllowedEngineBaseUrl } from '../shared/window-url-policy.js';
import {
  appendRunLog,
  resolveLogsDir,
} from '../shared/project-logs.js';
import {
  findLatestSessionLog,
  openSessionLog,
  writeSessionExport,
} from './sessionLog.js';
import {
  findLatestModelIoLog,
  isModelIoLoggingEnabled,
  openModelIoLog,
  setActiveModelIoSink,
} from './modelIoLog.js';
import { writeShareableDiagnostic } from './shareableDiagnostic.js';
import {
  buildDesktopStartExtras,
  readDesktopSettingsJson,
} from './startOptions.js';
import {
  activateProfile,
  deleteProfile,
  hashSecret,
  profileFromProvider,
  readProfiles,
  uniqueProfileId,
  upsertProfile,
  writeProfiles,
  type DesktopProfileProvider,
} from './profiles.js';
import {
  createThread,
  deleteThread,
  loadHistory,
  saveHistory,
  upsertThreadMessages,
  upsertThreadTokenUsage,
  type DesktopChatMessage,
  type DesktopThreadTokenUsage,
} from './history.js';
import {
  getIndexStatus,
  pauseWorkspaceIndex,
  reindexWorkspace,
} from './index-status.js';
import {
  clearCheckpointLabels,
  deleteCheckpointLabel,
  loadCheckpointLabels,
  recordCheckpointLabel,
} from './checkpointLabels.js';
import { workspaceIdFromRoot } from './workspace-id.js';
import {
  getGitFileChangesSummary,
  getGitFileDiff,
  getGitWorkingTreeCoalesced,
  gitCheckout,
  gitCommit,
  gitDiscard,
  gitStage,
  gitUnstage,
  listGitBranches,
} from './git/workingTree.js';
import { getGitStatus } from './git/status.js';
import {
  copyWorkspaceEntries,
  createWorkspaceFile,
  createWorkspaceFolder,
  listWorkspaceDir,
  moveWorkspaceEntries,
  readWorkspaceFile,
  renameWorkspaceEntry,
  deleteWorkspaceEntries,
  searchWorkspacePaths,
  toAbsoluteWorkspacePath,
  writeWorkspaceFile,
} from './explorer/workspaceFs.js';

const THOROUGHNESS_MAP = {
  low: { depth: 'quick' as const, effort: 'low' as const },
  medium: { depth: 'auto' as const, effort: 'medium' as const },
  high: { depth: 'deep' as const, effort: 'high' as const },
};

const APPROVAL_PRESET_MAP = {
  safe: {
    approvalMode: 'every_mutation' as const,
    planApproval: 'policy' as const,
  },
  guided: {
    approvalMode: 'when_required' as const,
    planApproval: 'policy' as const,
  },
  pilot: {
    approvalMode: 'never' as const,
    planApproval: 'never' as const,
  },
  builder: {
    approvalMode: 'when_required' as const,
    planApproval: 'policy' as const,
  },
};

function resolveApprovalPreset(preset: string | undefined): {
  approvalMode: 'never' | 'when_required' | 'every_mutation';
  planApproval: 'policy' | 'never';
} {
  const key =
    preset === 'safe' ||
    preset === 'guided' ||
    preset === 'pilot' ||
    preset === 'builder'
      ? preset
      : 'guided';
  return APPROVAL_PRESET_MAP[key];
}

function asStringArray(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, max);
  return out.length > 0 ? out : undefined;
}

function asOptionalStringPaths(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  return asStringArray(value, 200) ?? [];
}

function readCommitMessageStyle(
  body: Record<string, unknown>,
): 'conventional' | 'plain' | undefined {
  if (body.commitMessageStyle === 'conventional' || body.commitMessageStyle === 'plain') {
    return body.commitMessageStyle;
  }
  const json = process.env.MITII_DESKTOP_SETTINGS_JSON?.trim();
  if (!json) return undefined;
  try {
    const root = JSON.parse(json) as { scm?: { commitMessageStyle?: unknown } };
    const style = root.scm?.commitMessageStyle;
    if (style === 'conventional' || style === 'plain') return style;
  } catch {
    /* ignore */
  }
  return undefined;
}

function parseConversation(
  value: unknown,
): MitiiStartInput['conversation'] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: NonNullable<MitiiStartInput['conversation']> = [];
  for (const item of value.slice(0, 200)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const role = record.role === 'assistant' ? 'assistant' : 'user';
    const content =
      typeof record.content === 'string'
        ? record.content.trim()
        : typeof record.text === 'string'
          ? record.text.trim()
          : '';
    if (!content) continue;
    out.push({ role, content });
  }
  return out.length > 0 ? out : undefined;
}

function buildStartInput(
  body: Record<string, unknown>,
  parsed: {
    prompt: string;
    mode?: 'ask' | 'plan' | 'agent';
    id?: string;
    model?: string;
    sessionId?: string;
  },
  workspaceRoot: string,
): MitiiStartInput {
  const approvalPreset =
    typeof body.approvalPreset === 'string' ? body.approvalPreset : 'guided';
  const policy = resolveApprovalPreset(approvalPreset);
  const thoroughnessRaw =
    typeof body.thoroughness === 'string' ? body.thoroughness : 'medium';
  const thoroughness =
    thoroughnessRaw === 'low' || thoroughnessRaw === 'high'
      ? thoroughnessRaw
      : 'medium';
  const intensity = THOROUGHNESS_MAP[thoroughness];
  const pinnedPaths = asStringArray(body.pinnedPaths, 32);
  const requiredSkillIds = asStringArray(body.requiredSkillIds, 16);
  const requiredMcpServerIds = asStringArray(body.requiredMcpServerIds, 16);
  const conversation = parseConversation(body.conversation);
  const approvedPlanParse = planArtifactSchema.safeParse(body.approvedPlan);
  const approvedPlan = approvedPlanParse.success
    ? approvedPlanParse.data
    : undefined;
  const strategyParse = planStrategyDecisionSchema.safeParse(
    body.approvedPlanStrategy,
  );
  const approvedPlanStrategy = strategyParse.success
    ? strategyParse.data
    : undefined;
  const taskListParse = taskListSchema.safeParse(body.taskList);
  const taskList = taskListParse.success ? taskListParse.data : undefined;
  const modelRaw =
    (typeof body.model === 'string' && body.model.trim()
      ? body.model.trim()
      : undefined) ??
    parsed.model ??
    process.env.MITII_MODEL?.trim() ??
    '';
  const model = modelRaw
    ? normalizeOllamaModelId(modelRaw, process.env.MITII_BASE_URL)
    : undefined;

  const extras = buildDesktopStartExtras(process.env);

  return {
    prompt: parsed.prompt,
    mode: parsed.mode ?? 'ask',
    workspaceRoot,
    approvalMode: policy.approvalMode,
    planApproval: policy.planApproval,
    explorationDepth: intensity.depth,
    windowBudget: {
      effort: intensity.effort,
      ...(extras.windowBudget?.policy
        ? { policy: extras.windowBudget.policy }
        : {}),
      ...(extras.windowBudget?.maximumOutputTokens != null
        ? { maximumOutputTokens: extras.windowBudget.maximumOutputTokens }
        : {}),
    },
    ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
    ...(model ? { model } : {}),
    ...(pinnedPaths ? { pinnedPaths } : {}),
    ...(requiredSkillIds ? { requiredSkillIds } : {}),
    ...(requiredMcpServerIds ? { requiredMcpServerIds } : {}),
    ...(conversation ? { conversation } : {}),
    ...(approvedPlan ? { approvedPlan } : {}),
    ...(approvedPlanStrategy ? { approvedPlanStrategy } : {}),
    ...(taskList ? { taskList } : {}),
    ...(extras.budget ? { budget: extras.budget } : {}),
    ...(extras.loopPolicy ? { loopPolicy: extras.loopPolicy } : {}),
    ...(extras.logVerbosity ? { logVerbosity: extras.logVerbosity } : {}),
  };
}

/** Optional host context blocks from ui.contextToggles (gitDiff today). */
async function attachContextEnvironment(
  startInput: MitiiStartInput,
  workspaceRoot: string,
): Promise<MitiiStartInput> {
  const settings = readDesktopSettingsJson(process.env);
  const ui = settings?.ui;
  const toggles =
    ui && typeof ui === 'object' && !Array.isArray(ui)
      ? (ui as Record<string, unknown>).contextToggles
      : undefined;
  const gitDiffOn =
    toggles &&
    typeof toggles === 'object' &&
    !Array.isArray(toggles) &&
    (toggles as Record<string, unknown>).gitDiff === true;
  if (!gitDiffOn) return startInput;

  try {
    const status = await getGitStatus(workspaceRoot);
    if (!status.ok || status.files.length === 0) return startInput;
    const lines = status.files
      .slice(0, 40)
      .map((f) => `${f.status} ${f.path}`);
    const content = [
      status.branch ? `Branch: ${status.branch}` : null,
      status.summary,
      ...lines,
    ]
      .filter(Boolean)
      .join('\n');
    const block = {
      id: 'git-diff',
      title: 'Git working tree',
      content,
      priority: 40,
    };
    return {
      ...startInput,
      environment: [...(startInput.environment ?? []), block],
    };
  } catch {
    return startInput;
  }
}

async function streamRun(
  id: string,
  mode: 'ask' | 'plan' | 'agent',
  startOrResume: () => ReturnType<MitiiClient['start']>,
  res: ServerResponse,
  meta?: {
    model?: string;
    baseUrl?: string;
    workspaceRoot?: string;
    prompt?: string;
    sessionId?: string;
    conversationCount?: number;
  },
  req?: IncomingMessage,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'transfer-encoding': 'chunked',
  });
  writeNdjson(res, { op: 'ready', id, mode });
  const logsDir = resolveLogsDir();
  appendRunLog(logsDir, `run_start id=${id} mode=${mode}`, {
    model: meta?.model ?? process.env.MITII_MODEL ?? '',
    baseUrl: meta?.baseUrl ?? process.env.MITII_BASE_URL ?? '',
  });

  const mcpManager = getSharedMcpManager({ clientInfoName: 'mitii-desktop' });
  const workspaceRoot = meta?.workspaceRoot;
  mcpManager.setToolResultListener(async (event) => {
    if (!workspaceRoot) return;
    if (event.toolName !== 'create_view' || event.result.isError) return;

    const persisted = persistExcalidrawFromToolResult({
      workspaceRoot,
      event,
      threadId: meta?.sessionId ?? id,
    });
    if (!persisted) {
      appendRunLog(
        logsDir,
        '[mcp-app] create_view succeeded but no elements were available to persist',
      );
      return;
    }

    let html: string | undefined;
    if (event.resourceUri) {
      try {
        const resource = await mcpManager.readResource(
          event.serverId,
          event.resourceUri,
        );
        const first = resource.contents[0];
        if (first?.text) {
          html = first.text;
        } else if (first?.blob) {
          html = Buffer.from(first.blob, 'base64').toString('utf8');
        }
      } catch (error) {
        appendRunLog(
          logsDir,
          `[mcp-app] resources/read failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(
      persisted.svg,
      'utf8',
    ).toString('base64')}`;

    appendRunLog(
      logsDir,
      `[mcp-app] saved diagram → ${persisted.paths.relativeMd}`,
    );

    writeNdjson(res, {
      op: 'event',
      id,
      event: {
        type: 'mcp_app',
        at: new Date().toISOString(),
        detail: `Saved ${persisted.paths.relativeMd}`,
        mcpApp: {
          serverId: event.serverId,
          tool: event.toolName,
          title: persisted.title,
          ...(persisted.paths.checkpointId
            ? { checkpointId: persisted.paths.checkpointId }
            : {}),
          svgDataUrl,
          ...(html ? { html } : {}),
          paths: {
            md: persisted.paths.relativeMd,
            ...(persisted.paths.relativeDocsMd
              ? { docsMd: persisted.paths.relativeDocsMd }
              : {}),
            excalidraw: persisted.paths.relativeExcalidraw,
            svg: persisted.paths.relativeSvg,
          },
        },
      },
    });
  });

  let sessionLog: ReturnType<typeof openSessionLog>;
  let modelIoLog: ReturnType<typeof openModelIoLog>;
  try {
    const run = startOrResume();
    const onClientGone = () => {
      if (res.writableEnded) return;
      appendRunLog(logsDir, `run_cancel id=${id} reason=user_cancelled`);
      try {
        run.cancel('user_cancelled');
      } catch {
        /* ignore */
      }
    };
    req?.once('close', onClientGone);
    res.once('close', onClientGone);

    const runStartedAt = new Date().toISOString();
    sessionLog = openSessionLog(meta?.workspaceRoot, {
      at: runStartedAt,
      prompt: meta?.prompt ?? '',
      mode,
      sessionId: meta?.sessionId ?? id,
      runId: run.runId ?? id,
      conversationCount: meta?.conversationCount ?? 0,
    });
    if (sessionLog?.path) {
      appendRunLog(logsDir, `session_log ${sessionLog.path}`);
    }

    const settings = readDesktopSettingsJson(process.env);
    const developer = settings?.developer as Record<string, unknown> | undefined;
    const modelIoOn = isModelIoLoggingEnabled(
      developer?.enabled === true,
      developer?.modelIo === true,
    );
    modelIoLog = modelIoOn
      ? openModelIoLog(meta?.workspaceRoot, {
          at: runStartedAt,
          sessionId: meta?.sessionId ?? id,
          runId: run.runId ?? id,
        })
      : undefined;
    if (modelIoLog) {
      setActiveModelIoSink(modelIoLog);
      appendRunLog(logsDir, `model_io ${modelIoLog.path}`);
    }

    try {
      for await (const event of run.events) {
        sessionLog?.appendEvent(event);
        writeNdjson(res, { op: 'event', id, event });
      }
      const result = await run.result;
      if (result.status !== 'suspended') {
        sessionLog?.finish(result);
      }
      if (result.status === 'completed' && meta?.workspaceRoot) {
        const promptLabel = (meta.prompt ?? 'run').trim() || 'run';
        try {
          await recordCheckpointLabel({
            workspaceRoot: meta.workspaceRoot,
            label: `After: ${promptLabel.slice(0, 40)}`,
          });
        } catch {
          // Label snapshot is best-effort; never fail the run stream.
        }
      }
      writeNdjson(res, { op: 'result', id, result });
      appendRunLog(logsDir, `run_ok id=${id} status=${result.status}`);
    } finally {
      req?.off('close', onClientGone);
      res.off('close', onClientGone);
      setActiveModelIoSink(undefined);
      modelIoLog?.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendRunLog(logsDir, `run_failed id=${id} ${message}`, {
      model: meta?.model ?? process.env.MITII_MODEL ?? '',
      baseUrl: meta?.baseUrl ?? process.env.MITII_BASE_URL ?? '',
    });
    writeNdjson(res, { op: 'error', id, error: 'run_failed', message });
  } finally {
    mcpManager.setToolResultListener(undefined);
  }
  res.end();
}

export { generateEngineToken };

export interface EngineServerOptions {
  client: MitiiClient;
  mode: DesktopHostMode;
  workspaceRoot: string;
  host?: string;
  port?: number;
  /** Optional bearer token; when set, /v1/* requires Authorization: Bearer … */
  token?: string;
}

export interface EngineServerHandle {
  url: string;
  host: string;
  port: number;
  token: string | undefined;
  close: () => Promise<void>;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const max = 2 * 1024 * 1024;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function writeNdjson(res: ServerResponse, line: DesktopPromptStreamLine): void {
  res.write(`${JSON.stringify(line)}\n`);
}

function authorize(
  req: IncomingMessage,
  token: string | undefined,
): boolean {
  if (!token) return true;
  const header = req.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return Boolean(match && match[1] === token);
}

function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
  token: string | undefined,
): boolean {
  if (authorize(req, token)) return true;
  sendJson(res, 401, { op: 'error', error: 'unauthorized' });
  return false;
}

function fallbackProviderFromEnv(): DesktopProfileProvider {
  return {
    type: process.env.MITII_PROVIDER ?? 'echo',
    preset: process.env.MITII_PROVIDER_PRESET ?? process.env.MITII_PROVIDER ?? 'echo',
    baseUrl: process.env.MITII_BASE_URL ?? '',
    model: process.env.MITII_MODEL ?? '',
    contextWindow: 0,
    maximumOutputTokens: 0,
  };
}

async function handlePrompt(
  client: MitiiClient,
  workspaceRoot: string,
  body: unknown,
  res: ServerResponse,
  req: IncomingMessage,
): Promise<void> {
  const parsed = parseDesktopPromptBody(body);
  if ('error' in parsed) {
    sendJson(res, 400, { op: 'error', error: parsed.error });
    return;
  }
  const id = createPromptId(parsed.id);
  const mode = parsed.mode ?? 'ask';
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const startInput = await attachContextEnvironment(
    buildStartInput(record, parsed, workspaceRoot),
    workspaceRoot,
  );
  await streamRun(id, mode, () => client.start(startInput), res, {
    model: startInput.model,
    baseUrl: process.env.MITII_BASE_URL,
    workspaceRoot,
    prompt: parsed.prompt,
    sessionId: parsed.sessionId ?? id,
    conversationCount: startInput.conversation?.length ?? 0,
  }, req);
}

async function handleResume(
  client: MitiiClient,
  workspaceRoot: string,
  body: unknown,
  res: ServerResponse,
  req: IncomingMessage,
): Promise<void> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, { op: 'error', error: 'expected_object' });
    return;
  }
  const record = body as Record<string, unknown>;
  const runId = typeof record.runId === 'string' ? record.runId.trim() : '';
  if (!runId) {
    sendJson(res, 400, { op: 'error', error: 'runId_required' });
    return;
  }
  const id = createPromptId(
    typeof record.id === 'string' ? record.id : undefined,
  );
  const mode =
    record.mode === 'plan' || record.mode === 'agent' ? record.mode : 'ask';
  const sessionId =
    typeof record.sessionId === 'string' && record.sessionId.trim()
      ? record.sessionId.trim()
      : id;

  const resume: MitiiResumeInput = {
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    runId,
  };

  if (record.approval && typeof record.approval === 'object') {
    const a = record.approval as Record<string, unknown>;
    const approvalId = typeof a.approvalId === 'string' ? a.approvalId : '';
    const decision =
      a.decision === 'approved' || a.decision === 'denied' ? a.decision : null;
    if (approvalId && decision) {
      resume.approval = { approvalId, decision };
    }
  }
  if (typeof record.clarificationAnswer === 'string' && record.clarificationAnswer.trim()) {
    resume.clarificationAnswer = record.clarificationAnswer.trim();
  }
  if (record.planDecision && typeof record.planDecision === 'object') {
    const p = record.planDecision as Record<string, unknown>;
    if (
      p.decision === 'approved' ||
      p.decision === 'rejected' ||
      p.decision === 'edited'
    ) {
      resume.planDecision = { decision: p.decision };
    }
  }
  if (record.grantExpansion && typeof record.grantExpansion === 'object') {
    const g = record.grantExpansion as Record<string, unknown>;
    const expansionId = typeof g.expansionId === 'string' ? g.expansionId : '';
    const decision =
      g.decision === 'approved' || g.decision === 'denied' ? g.decision : null;
    if (expansionId && decision) {
      resume.grantExpansion = { expansionId, decision };
    }
  }
  if (record.continueDecision && typeof record.continueDecision === 'object') {
    const c = record.continueDecision as Record<string, unknown>;
    if (c.decision === 'continue' || c.decision === 'stop') {
      resume.continueDecision = {
        decision: c.decision,
        ...(typeof c.guidance === 'string' && c.guidance.trim()
          ? { guidance: c.guidance.trim() }
          : {}),
      };
    }
  }
  if (typeof record.approvalPreset === 'string') {
    resume.approvalMode = resolveApprovalPreset(record.approvalPreset)
      .approvalMode;
  }

  const hasDecision = Boolean(
    resume.approval ||
      resume.clarificationAnswer ||
      resume.planDecision ||
      resume.grantExpansion ||
      resume.continueDecision,
  );
  if (!hasDecision) {
    sendJson(res, 400, { op: 'error', error: 'resume_decision_required' });
    return;
  }

  await streamRun(id, mode, () => client.resume(resume), res, {
    workspaceRoot,
    sessionId,
    prompt: typeof record.prompt === 'string' ? record.prompt : '(resume)',
    model: process.env.MITII_MODEL,
    baseUrl: process.env.MITII_BASE_URL,
  }, req);
}

export async function startEngineServer(
  options: EngineServerOptions,
): Promise<EngineServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const token = options.token;
  const cwd = options.workspaceRoot;
  const workspaceWatcher = createWorkspaceWatcher(cwd);
  const resolveDesktopSemanticIndex = (): SemanticIndexSettings | undefined => {
    const normalizeSource = (
      raw: string | undefined,
    ): SemanticIndexSettings['source'] => {
      if (raw === 'ollama' || raw === 'bundled' || raw === 'disabled') return raw;
      if (raw === 'openai-compatible' || raw === 'openai_compatible') {
        return 'openai-compatible';
      }
      return 'bundled';
    };
    try {
      const settings = readDesktopSettingsJson();
      const semantic = settings?.semanticIndex as
        | {
            enabled?: boolean;
            source?: string;
            model?: string;
            dimensions?: number;
            normalized?: boolean;
          }
        | undefined;
      const provider = settings?.provider as { baseUrl?: string } | undefined;
      return {
        enabled: semantic?.enabled !== false,
        source: normalizeSource(semantic?.source),
        model: semantic?.model ?? '',
        dimensions: semantic?.dimensions ?? 0,
        normalized: semantic?.normalized !== false,
        baseUrl: provider?.baseUrl ?? process.env.MITII_BASE_URL ?? '',
        apiKey: process.env.MITII_API_KEY,
      };
    } catch {
      return {
        enabled: true,
        source: 'bundled',
        model: '',
        dimensions: 0,
        normalized: true,
        baseUrl: '',
      };
    }
  };
  const resolveDesktopIndexConcurrency = (): number =>
    // Leave headroom on the shared engine thread for explorer HTTP.
    Math.min(4, resolveIndexConcurrency());

  const incrementalIndex = startIncrementalWorkspaceIndex({
    workspaceRoot: cwd,
    watcher: workspaceWatcher,
    resolveSemanticIndex: resolveDesktopSemanticIndex,
    resolveConcurrency: resolveDesktopIndexConcurrency,
  });

  const server: Server = createServer((req, res) => {
    void (async () => {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const path = url.pathname;

      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, {
          ok: true,
          protocol: MITII_DESKTOP_PROTOCOL,
          version: MITII_DESKTOP_PROTOCOL_VERSION,
          mode: options.mode,
          workspaceRoot: cwd,
        });
        return;
      }

      if (method === 'POST' && path === '/v1/prompt') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = await readJsonBody(req);
          await handlePrompt(options.client, cwd, body, res, req);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (!res.headersSent) {
            sendJson(res, 400, {
              op: 'error',
              error: message === 'invalid_json' ? 'invalid_json' : 'bad_request',
              message,
            });
          } else {
            writeNdjson(res, {
              op: 'error',
              error: 'bad_request',
              message,
            });
            res.end();
          }
        }
        return;
      }

      if (method === 'POST' && path === '/v1/resume') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = await readJsonBody(req);
          await handleResume(options.client, cwd, body, res, req);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (!res.headersSent) {
            sendJson(res, 400, {
              op: 'error',
              error: message === 'invalid_json' ? 'invalid_json' : 'bad_request',
              message,
            });
          } else {
            writeNdjson(res, {
              op: 'error',
              error: 'bad_request',
              message,
            });
            res.end();
          }
        }
        return;
      }

      if (method === 'GET' && path === '/v1/skills') {
        if (!requireAuth(req, res, token)) return;
        const catalog = createFileSystemSkillsCatalog({
          workspaceRoot: cwd,
          contentMode: 'metadata',
        });
        const skills = await catalog.list();
        const workspaceIds = new Set(
          listWorkspaceSkills(cwd).map((s) => s.id),
        );
        sendJson(res, 200, {
          skills: skills.map(
            (s: { id: string; title: string; description?: string }) => ({
              id: s.id,
              title: s.title || s.id,
              description: s.description ?? '',
              source: workspaceIds.has(s.id) ? 'workspace' : 'bundled',
            }),
          ),
          workspace: listWorkspaceSkills(cwd),
        });
        return;
      }

      if (method === 'GET' && path === '/v1/skills/workspace') {
        if (!requireAuth(req, res, token)) return;
        const id = url.searchParams.get('id')?.trim() ?? '';
        if (!id) {
          sendJson(res, 200, {
            skills: listWorkspaceSkills(cwd),
            draft: defaultNewSkillDraft(),
          });
          return;
        }
        try {
          sendJson(res, 200, { skill: readWorkspaceSkill(cwd, id) });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 404, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/skills/format') {
        if (!requireAuth(req, res, token)) return;
        try {
          requireActiveDesktopProfile(cwd);
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const markdownOrBody =
            typeof body.markdown === 'string'
              ? body.markdown
              : typeof body.body === 'string'
                ? body.body
                : '';
          if (!markdownOrBody.trim()) {
            sendJson(res, 400, { ok: false, error: 'body_required' });
            return;
          }
          const formatted = await formatSkillFrontmatterWithAi({
            workspaceRoot: cwd,
            markdownOrBody,
            ...(typeof body.id === 'string' ? { nameHint: body.id } : {}),
            ...(typeof body.title === 'string'
              ? { titleHint: body.title }
              : {}),
            ...(typeof body.description === 'string'
              ? { descriptionHint: body.description }
              : {}),
            useAi: body.useAi !== false,
          });
          sendJson(res, 200, { ok: true, ...formatted });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const status =
            message === 'active_profile_required' ? 403 : 400;
          sendJson(res, status, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/skills/workspace') {
        if (!requireAuth(req, res, token)) return;
        try {
          requireActiveDesktopProfile(cwd);
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const action =
            typeof body.action === 'string' ? body.action.trim() : 'save';

          if (action === 'delete') {
            const id =
              typeof body.id === 'string'
                ? body.id
                : typeof body.skillId === 'string'
                  ? body.skillId
                  : '';
            const deleted = deleteWorkspaceSkill(cwd, id);
            sendJson(res, 200, {
              ok: true,
              ...deleted,
              skills: listWorkspaceSkills(cwd),
            });
            return;
          }

          const formatFrontmatter = body.formatFrontmatter !== false;
          let markdown =
            typeof body.markdown === 'string' ? body.markdown : '';
          const rawBody =
            typeof body.body === 'string' ? body.body : '';
          const idHint =
            typeof body.id === 'string' ? body.id : undefined;
          const titleHint =
            typeof body.title === 'string' ? body.title : undefined;
          const descriptionHint =
            typeof body.description === 'string'
              ? body.description
              : undefined;

          let formatMeta:
            | Awaited<ReturnType<typeof formatSkillFrontmatterWithAi>>
            | undefined;

          if (formatFrontmatter) {
            formatMeta = await formatSkillFrontmatterWithAi({
              workspaceRoot: cwd,
              markdownOrBody: markdown || rawBody,
              ...(idHint ? { nameHint: idHint } : {}),
              ...(titleHint ? { titleHint } : {}),
              ...(descriptionHint ? { descriptionHint } : {}),
              useAi: body.useAi !== false,
            });
            markdown = formatMeta.markdown;
          } else if (!markdown && rawBody) {
            const saved = writeWorkspaceSkill(cwd, {
              id: idHint || 'custom-skill',
              title: titleHint,
              description: descriptionHint,
              body: rawBody,
            });
            sendJson(res, 200, {
              ok: true,
              ...saved,
              skill: readWorkspaceSkill(cwd, saved.id),
              draft: defaultNewSkillDraft(),
            });
            return;
          }

          if (!markdown.trim()) {
            sendJson(res, 400, { ok: false, error: 'markdown_required' });
            return;
          }

          const saved = writeWorkspaceSkillMarkdown(cwd, {
            ...(idHint ? { id: idHint } : {}),
            ...(formatMeta ? { id: formatMeta.id } : {}),
            markdown,
          });
          sendJson(res, 200, {
            ok: true,
            ...saved,
            skill: readWorkspaceSkill(cwd, saved.id),
            draft: defaultNewSkillDraft(),
            ...(formatMeta
              ? {
                  usedAi: formatMeta.usedAi,
                  recipeId: formatMeta.recipeId,
                  profileId: formatMeta.profileId,
                  profileName: formatMeta.profileName,
                }
              : {}),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const status =
            message === 'active_profile_required' ? 403 : 400;
          sendJson(res, status, { ok: false, error: message });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/mcp') {
        if (!requireAuth(req, res, token)) return;
        sendJson(res, 200, listMcpServers(cwd));
        return;
      }

      if (method === 'POST' && path === '/v1/mcp') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const action =
            typeof body.action === 'string' ? body.action.trim() : '';

          if (action === 'install' || action === 'installBuiltin') {
            const builtinId =
              typeof body.builtinId === 'string'
                ? body.builtinId
                : typeof body.id === 'string'
                  ? body.id
                  : '';
            if (!builtinId) {
              sendJson(res, 400, { ok: false, error: 'builtinId_required' });
              return;
            }
            const secrets =
              body.secrets &&
              typeof body.secrets === 'object' &&
              !Array.isArray(body.secrets)
                ? Object.fromEntries(
                    Object.entries(body.secrets as Record<string, unknown>)
                      .filter(
                        (entry): entry is [string, string] =>
                          typeof entry[0] === 'string' &&
                          typeof entry[1] === 'string',
                      )
                      .map(([k, v]) => [k, v]),
                  )
                : body.env &&
                    typeof body.env === 'object' &&
                    !Array.isArray(body.env)
                  ? Object.fromEntries(
                      Object.entries(body.env as Record<string, unknown>)
                        .filter(
                          (entry): entry is [string, string] =>
                            typeof entry[0] === 'string' &&
                            typeof entry[1] === 'string',
                        )
                        .map(([k, v]) => [k, v]),
                    )
                  : undefined;
            sendJson(res, 200, {
              ok: true,
              ...installBuiltinMcpServer(cwd, builtinId, secrets),
              restartRequired: true,
            });
            return;
          }

          if (action === 'add' || action === 'create') {
            const transport =
              body.transport === 'stdio' ||
              body.transport === 'sse' ||
              body.transport === 'streamable-http'
                ? body.transport
                : null;
            if (!transport) {
              sendJson(res, 400, { ok: false, error: 'transport_required' });
              return;
            }
            const args = Array.isArray(body.args)
              ? body.args
                  .filter((v): v is string => typeof v === 'string')
                  .map((v) => v.trim())
                  .filter(Boolean)
              : typeof body.args === 'string'
                ? body.args
                    .split(/\s+/)
                    .map((v) => v.trim())
                    .filter(Boolean)
                : undefined;
            const headers =
              body.headers &&
              typeof body.headers === 'object' &&
              !Array.isArray(body.headers)
                ? Object.fromEntries(
                    Object.entries(body.headers as Record<string, unknown>)
                      .filter(
                        (entry): entry is [string, string] =>
                          typeof entry[0] === 'string' &&
                          typeof entry[1] === 'string',
                      )
                      .map(([k, v]) => [k, v]),
                  )
                : undefined;
            sendJson(res, 200, {
              ok: true,
              ...addCustomMcpServer(cwd, {
                id: typeof body.id === 'string' ? body.id : '',
                name: typeof body.name === 'string' ? body.name : '',
                transport,
                ...(typeof body.command === 'string'
                  ? { command: body.command }
                  : {}),
                ...(args ? { args } : {}),
                ...(typeof body.cwd === 'string' ? { cwd: body.cwd } : {}),
                ...(typeof body.url === 'string' ? { url: body.url } : {}),
                ...(headers ? { headers } : {}),
                enabled: body.enabled !== false,
              }),
              restartRequired: true,
            });
            return;
          }

          if (action === 'delete' || action === 'remove') {
            const serverId =
              typeof body.serverId === 'string'
                ? body.serverId
                : typeof body.id === 'string'
                  ? body.id
                  : '';
            if (!serverId) {
              sendJson(res, 400, { ok: false, error: 'serverId_required' });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              ...deleteMcpServer(cwd, serverId),
              restartRequired: true,
            });
            return;
          }

          if (typeof body.enabled === 'boolean' && body.serverId == null) {
            sendJson(res, 200, {
              ok: true,
              ...setMcpMasterEnabled(cwd, body.enabled),
            });
            return;
          }
          const serverId =
            typeof body.serverId === 'string'
              ? body.serverId
              : typeof body.id === 'string'
                ? body.id
                : '';
          if (!serverId || typeof body.enabled !== 'boolean') {
            sendJson(res, 400, {
              ok: false,
              error: 'serverId_and_enabled_required',
            });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            ...setMcpServerEnabled(cwd, serverId, body.enabled),
            restartRequired: true,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/recipes') {
        if (!requireAuth(req, res, token)) return;
        sendJson(res, 200, {
          recipes: listRecipes(cwd),
          draft: defaultNewRecipeDraft(),
        });
        return;
      }

      if (method === 'POST' && path === '/v1/recipes') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const saved = writeRecipe(cwd, body.recipe ?? body);
          sendJson(res, 200, { ok: true, ...saved });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/recipes/run') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const id = typeof body.id === 'string' ? body.id : '';
          const params =
            body.params && typeof body.params === 'object'
              ? (body.params as Record<string, string>)
              : {};
          const note =
            typeof body.note === 'string' ? body.note : undefined;
          const commitMessageStyle = readCommitMessageStyle(body);
          const spec = loadDesktopRecipeSpec(cwd, id);
          const compiled = await compileRecipeToStartInput(spec, {
            workspaceRoot: cwd,
            params,
            userNote: note,
            ...(commitMessageStyle ? { commitMessageStyle } : {}),
          });
          sendJson(res, 200, { ok: true, compiled });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/workspace/tree') {
        if (!requireAuth(req, res, token)) return;
        try {
          const rel = url.searchParams.get('path') ?? '';
          const entries = await listWorkspaceDir(cwd, rel);
          sendJson(res, 200, { path: rel, entries });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/workspace/events') {
        if (!requireAuth(req, res, token)) return;
        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write(
          `${JSON.stringify({
            type: 'ready',
            at: Date.now(),
            workspaceRoot: cwd,
          })}\n`,
        );
        const onChange = (event: WorkspaceChangeEvent) => {
          if (res.writableEnded) return;
          try {
            res.write(
              `${JSON.stringify({
                type: 'change',
                at: event.at,
                paths: event.paths,
                kind: event.kind,
              })}\n`,
            );
          } catch {
            /* client gone */
          }
        };
        const unsubscribe = workspaceWatcher.subscribe(onChange);
        const heartbeat = setInterval(() => {
          if (res.writableEnded) return;
          try {
            res.write(`${JSON.stringify({ type: 'ping', at: Date.now() })}\n`);
          } catch {
            /* ignore */
          }
        }, 25_000);
        const cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
        };
        req.on('close', cleanup);
        req.on('error', cleanup);
        res.on('close', cleanup);
        res.on('error', cleanup);
        return;
      }

      if (method === 'GET' && path === '/v1/workspace/search') {
        if (!requireAuth(req, res, token)) return;
        try {
          const q = url.searchParams.get('q') ?? '';
          const paths = await searchWorkspacePaths(cwd, q, 40);
          sendJson(res, 200, { query: q, paths });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/workspace/file') {
        if (!requireAuth(req, res, token)) return;
        try {
          const rel = url.searchParams.get('path') ?? '';
          const file = await readWorkspaceFile(cwd, rel);
          sendJson(res, 200, file);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/workspace/file') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const rel = typeof body.path === 'string' ? body.path : '';
          const content = typeof body.content === 'string' ? body.content : '';
          const saved = await writeWorkspaceFile(cwd, rel, content);
          sendJson(res, 200, { ok: true, ...saved });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/workspace/create-file') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const parent =
            typeof body.parent === 'string'
              ? body.parent
              : typeof body.path === 'string'
                ? body.path
                : '';
          const name = typeof body.name === 'string' ? body.name : '';
          const content =
            typeof body.content === 'string' ? body.content : '';
          const created = await createWorkspaceFile(cwd, parent, name, content);
          sendJson(res, 200, { ok: true, ...created });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/workspace/create-folder') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const parent =
            typeof body.parent === 'string'
              ? body.parent
              : typeof body.path === 'string'
                ? body.path
                : '';
          const name = typeof body.name === 'string' ? body.name : '';
          const created = await createWorkspaceFolder(cwd, parent, name);
          sendJson(res, 200, { ok: true, ...created });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/workspace/copy') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const paths = Array.isArray(body.paths)
            ? body.paths.filter((p): p is string => typeof p === 'string')
            : typeof body.path === 'string'
              ? [body.path]
              : [];
          const destDir =
            typeof body.destDir === 'string' ? body.destDir : '';
          const result = await copyWorkspaceEntries(cwd, paths, destDir);
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/workspace/move') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const paths = Array.isArray(body.paths)
            ? body.paths.filter((p): p is string => typeof p === 'string')
            : typeof body.path === 'string'
              ? [body.path]
              : [];
          const destDir =
            typeof body.destDir === 'string' ? body.destDir : '';
          const result = await moveWorkspaceEntries(cwd, paths, destDir);
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/workspace/rename') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const rel = typeof body.path === 'string' ? body.path : '';
          const newName = typeof body.newName === 'string' ? body.newName : '';
          const renamed = await renameWorkspaceEntry(cwd, rel, newName);
          sendJson(res, 200, { ok: true, ...renamed });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/workspace/delete') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const paths = Array.isArray(body.paths)
            ? body.paths.filter((p): p is string => typeof p === 'string')
            : typeof body.path === 'string'
              ? [body.path]
              : [];
          const result = await deleteWorkspaceEntries(cwd, paths);
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/workspace/absolute') {
        if (!requireAuth(req, res, token)) return;
        try {
          const rel = url.searchParams.get('path') ?? '';
          sendJson(res, 200, {
            path: rel,
            absolute: toAbsoluteWorkspacePath(cwd, rel),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/git/status') {
        if (!requireAuth(req, res, token)) return;
        try {
          const wantStat = url.searchParams.get('stat') === '1';
          sendJson(
            res,
            200,
            await getGitWorkingTreeCoalesced(cwd, {
              includeStatPreview: wantStat,
            }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 500, {
            ok: false,
            summary: message,
            staged: [],
            changes: [],
            untracked: [],
            files: [],
            error: message,
          });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/git/diff') {
        if (!requireAuth(req, res, token)) return;
        const rel = url.searchParams.get('path') ?? '';
        sendJson(res, 200, await getGitFileDiff(cwd, rel));
        return;
      }

      if (method === 'POST' && path === '/v1/git/file-changes') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as { paths?: unknown };
          const paths = Array.isArray(body.paths)
            ? body.paths.filter((p): p is string => typeof p === 'string')
            : [];
          sendJson(res, 200, await getGitFileChangesSummary(cwd, paths));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/git/branches') {
        if (!requireAuth(req, res, token)) return;
        sendJson(res, 200, await listGitBranches(cwd));
        return;
      }

      if (method === 'POST' && path === '/v1/git/stage') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as { paths?: unknown };
          const paths = asOptionalStringPaths(body.paths);
          sendJson(res, 200, await gitStage(cwd, paths));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/git/unstage') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as { paths?: unknown };
          const paths = asOptionalStringPaths(body.paths);
          sendJson(res, 200, await gitUnstage(cwd, paths));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/git/discard') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as {
            paths?: unknown;
            includeUntracked?: unknown;
          };
          const paths = asOptionalStringPaths(body.paths) ?? [];
          const includeUntracked = body.includeUntracked === true;
          sendJson(
            res,
            200,
            await gitDiscard(cwd, paths, { includeUntracked }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/git/commit') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as {
            message?: unknown;
            all?: unknown;
          };
          const message =
            typeof body.message === 'string' ? body.message : '';
          sendJson(
            res,
            200,
            await gitCommit(cwd, message, { all: body.all === true }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/git/checkout') {
        if (!requireAuth(req, res, token)) return;
        try {
          const body = (await readJsonBody(req)) as {
            branch?: unknown;
            create?: unknown;
          };
          const branch =
            typeof body.branch === 'string' ? body.branch.trim() : '';
          if (!branch) {
            sendJson(res, 400, { ok: false, error: 'branch_required' });
            return;
          }
          sendJson(
            res,
            200,
            await gitCheckout(cwd, branch, {
              create: body.create === true,
            }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'POST' && path === '/v1/provider/test') {
        if (!requireAuth(req, res, token)) return;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const type = String(body.type ?? process.env.MITII_PROVIDER ?? 'echo');
        const baseUrl =
          typeof body.baseUrl === 'string'
            ? body.baseUrl
            : process.env.MITII_BASE_URL;
        const model =
          typeof body.model === 'string'
            ? body.model
            : (process.env.MITII_MODEL ?? '');
        const apiKey =
          typeof body.apiKey === 'string' && body.apiKey.trim()
            ? body.apiKey.trim()
            : process.env.MITII_API_KEY ??
              process.env.MITII_ANTHROPIC_API_KEY ??
              process.env.MITII_GEMINI_API_KEY;
        const result = await testProviderConnection({
          type,
          ...(baseUrl ? { baseUrl } : {}),
          model,
          ...(apiKey ? { apiKey } : {}),
        });
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && path === '/v1/provider/models') {
        if (!requireAuth(req, res, token)) return;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const type = String(body.type ?? process.env.MITII_PROVIDER ?? 'echo');
        const baseUrl =
          typeof body.baseUrl === 'string'
            ? body.baseUrl
            : process.env.MITII_BASE_URL;
        const apiKey =
          typeof body.apiKey === 'string' && body.apiKey.trim()
            ? body.apiKey.trim()
            : process.env.MITII_API_KEY ??
              process.env.MITII_ANTHROPIC_API_KEY ??
              process.env.MITII_GEMINI_API_KEY;
        const models = await listProviderModels({
          type,
          ...(baseUrl ? { baseUrl } : {}),
          ...(apiKey ? { apiKey } : {}),
        });
        sendJson(res, 200, { models });
        return;
      }

      if (method === 'POST' && path === '/v1/ollama/pull') {
        if (!requireAuth(req, res, token)) return;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const model =
          typeof body.model === 'string' && body.model.trim()
            ? body.model.trim()
            : DEFAULT_OLLAMA_EMBEDDING_MODEL;
        const baseUrl =
          typeof body.baseUrl === 'string' && body.baseUrl.trim()
            ? body.baseUrl.trim()
            : process.env.MITII_BASE_URL || 'http://127.0.0.1:11434/v1';

        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'transfer-encoding': 'chunked',
        });
        res.write(
          `${JSON.stringify({ op: 'start', model })}\n`,
        );

        const result = await pullOllamaModel({
          model,
          baseUrl,
          onProgress: (progress) => {
            res.write(
              `${JSON.stringify({
                op: 'progress',
                status: progress.status,
                ...(progress.percent !== undefined
                  ? { percent: progress.percent }
                  : {}),
                ...(progress.total !== undefined ? { total: progress.total } : {}),
                ...(progress.completed !== undefined
                  ? { completed: progress.completed }
                  : {}),
              })}\n`,
            );
          },
        });

        if (result.ok) {
          res.write(
            `${JSON.stringify({ op: 'done', ok: true, model: result.model })}\n`,
          );
        } else {
          res.write(
            `${JSON.stringify({
              op: 'done',
              ok: false,
              error: result.reason,
            })}\n`,
          );
        }
        res.end();
        return;
      }

      if (method === 'GET' && path === '/v1/memory') {
        if (!requireAuth(req, res, token)) return;
        const workspaceId = workspaceIdFromRoot(cwd);
        const memories = await listWorkspaceMemoriesForView(cwd, workspaceId);
        sendJson(res, 200, { memories });
        return;
      }

      if (method === 'POST' && path === '/v1/memory') {
        if (!requireAuth(req, res, token)) return;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const text = typeof body.text === 'string' ? body.text : '';
        try {
          const memories = await commitWorkspaceMemory({
            workspaceRoot: cwd,
            workspaceId: workspaceIdFromRoot(cwd),
            content: text,
          });
          sendJson(res, 200, { memories });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }

      if (method === 'DELETE' && path.startsWith('/v1/memory/')) {
        if (!requireAuth(req, res, token)) return;
        const id = decodeURIComponent(path.slice('/v1/memory/'.length));
        if (!id || id === 'clear') {
          sendJson(res, 400, { ok: false, error: 'memory_id_required' });
          return;
        }
        const memories = await deleteWorkspaceMemory({
          workspaceRoot: cwd,
          workspaceId: workspaceIdFromRoot(cwd),
          id,
        });
        sendJson(res, 200, { memories });
        return;
      }

      if (method === 'POST' && path === '/v1/memory/clear') {
        if (!requireAuth(req, res, token)) return;
        await clearWorkspaceMemories({
          workspaceRoot: cwd,
          workspaceId: workspaceIdFromRoot(cwd),
        });
        sendJson(res, 200, { memories: [] });
        return;
      }

      if (method === 'GET' && path === '/v1/checkpoints') {
        if (!requireAuth(req, res, token)) return;
        const checkpoints = await loadCheckpointLabels(cwd);
        sendJson(res, 200, { checkpoints });
        return;
      }

      if (method === 'DELETE' && path.startsWith('/v1/checkpoints/')) {
        if (!requireAuth(req, res, token)) return;
        const id = decodeURIComponent(path.slice('/v1/checkpoints/'.length));
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'checkpoint_id_required' });
          return;
        }
        const checkpoints = await deleteCheckpointLabel({
          workspaceRoot: cwd,
          id,
        });
        sendJson(res, 200, { checkpoints });
        return;
      }

      if (method === 'POST' && path === '/v1/checkpoints/clear') {
        if (!requireAuth(req, res, token)) return;
        await clearCheckpointLabels(cwd);
        sendJson(res, 200, { checkpoints: [] });
        return;
      }

      if (method === 'POST' && path.startsWith('/v1/checkpoints/') && path.endsWith('/restore')) {
        if (!requireAuth(req, res, token)) return;
        const id = decodeURIComponent(
          path.slice('/v1/checkpoints/'.length, -'/restore'.length),
        );
        // UI labels are not engine RestorePoints yet (same stub as VS Code panel).
        sendJson(res, 200, {
          ok: true,
          message: `Checkpoint restore for ${id} is recorded. Full file restore uses engine RestorePoints when available for a run.`,
        });
        return;
      }

      if (method === 'GET' && path === '/v1/profiles') {
        if (!requireAuth(req, res, token)) return;
        const hasSecret = Boolean(process.env.MITII_API_KEY?.trim());
        const file = readProfiles(cwd, fallbackProviderFromEnv(), {
          hasSecret,
          secretHash: hashSecret(process.env.MITII_API_KEY),
        });
        sendJson(res, 200, file);
        return;
      }

      if (method === 'POST' && path === '/v1/profiles') {
        if (!requireAuth(req, res, token)) return;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const action = String(body.action ?? 'upsert');
        let file = readProfiles(cwd, fallbackProviderFromEnv(), {
          hasSecret: Boolean(process.env.MITII_API_KEY?.trim()),
          secretHash: hashSecret(process.env.MITII_API_KEY),
        });

        if (action === 'activate') {
          const id = String(body.profileId ?? '');
          const next = activateProfile(file, id);
          if (!next) {
            sendJson(res, 404, { ok: false, error: 'profile_not_found' });
            return;
          }
          writeProfiles(cwd, next);
          const active = next.profiles.find((p) => p.id === id)!;
          sendJson(res, 200, { ok: true, profiles: next, active });
          return;
        }

        if (action === 'delete') {
          const id = String(body.profileId ?? '');
          const next = deleteProfile(file, id);
          if (!next) {
            sendJson(res, 400, {
              ok: false,
              error: 'cannot_delete_last_or_missing',
            });
            return;
          }
          writeProfiles(cwd, next);
          sendJson(res, 200, { ok: true, profiles: next });
          return;
        }

        const provider = (body.provider ?? {}) as Record<string, unknown>;
        const requestedId =
          typeof body.id === 'string' && body.id.trim()
            ? body.id.trim()
            : undefined;
        const requestedName =
          typeof body.name === 'string' && body.name.trim()
            ? body.name.trim()
            : 'Profile';
        const profile = profileFromProvider(
          {
            type: String(provider.type ?? 'echo'),
            preset:
              typeof provider.preset === 'string'
                ? provider.preset
                : String(provider.type ?? 'echo'),
            baseUrl: String(provider.baseUrl ?? ''),
            model: String(provider.model ?? ''),
            contextWindow: Number(provider.contextWindow) || 0,
            maximumOutputTokens: Number(provider.maximumOutputTokens) || 0,
          },
          {
            id:
              requestedId ??
              // New profiles must not reuse the reserved "default" id.
              uniqueProfileId(requestedName, file.profiles),
            name: requestedName,
            hasSecret: Boolean(body.hasSecret ?? process.env.MITII_API_KEY),
            secretHash: hashSecret(
              typeof body.apiKey === 'string'
                ? body.apiKey
                : process.env.MITII_API_KEY,
            ),
          },
        );
        file = upsertProfile(file, profile);
        writeProfiles(cwd, file);
        sendJson(res, 200, { ok: true, profiles: file, profile });
        return;
      }

      if (method === 'GET' && path === '/v1/history') {
        if (!requireAuth(req, res, token)) return;
        sendJson(res, 200, loadHistory(cwd));
        return;
      }

      if (method === 'POST' && path === '/v1/history') {
        if (!requireAuth(req, res, token)) return;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const action = String(body.action ?? 'save');
        let store = loadHistory(cwd);

        if (action === 'new') {
          store = createThread(
            store,
            typeof body.title === 'string' ? body.title : 'New chat',
          );
          saveHistory(cwd, store);
          sendJson(res, 200, store);
          return;
        }

        if (action === 'delete') {
          store = deleteThread(store, String(body.threadId ?? ''));
          saveHistory(cwd, store);
          sendJson(res, 200, store);
          return;
        }

        if (action === 'activate') {
          const threadId = String(body.threadId ?? '');
          if (!store.threads.some((t) => t.id === threadId)) {
            sendJson(res, 404, { error: 'thread_not_found' });
            return;
          }
          store = { ...store, activeThreadId: threadId };
          saveHistory(cwd, store);
          sendJson(res, 200, store);
          return;
        }

        // save messages (+ optional tokenUsage)
        const threadId = String(body.threadId ?? store.activeThreadId ?? '');
        if (!threadId) {
          store = createThread(store);
        }
        const id = threadId || store.activeThreadId!;
        const messages = Array.isArray(body.messages)
          ? (body.messages as DesktopChatMessage[])
          : undefined;
        const tokenUsage =
          body.tokenUsage && typeof body.tokenUsage === 'object'
            ? (body.tokenUsage as DesktopThreadTokenUsage)
            : undefined;

        if (messages) {
          store = upsertThreadMessages(store, id, messages, {
            title:
              typeof body.title === 'string' ? body.title : undefined,
            tokenUsage,
            ...(body.clearPendingPlan === true
              ? { clearPendingPlan: true }
              : {
                  ...(Object.prototype.hasOwnProperty.call(body, 'pendingPlan')
                    ? { pendingPlan: body.pendingPlan }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(
                    body,
                    'pendingPlanStrategy',
                  )
                    ? { pendingPlanStrategy: body.pendingPlanStrategy }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(
                    body,
                    'pendingTaskList',
                  )
                    ? { pendingTaskList: body.pendingTaskList }
                    : {}),
                }),
          });
        } else if (tokenUsage) {
          store = upsertThreadTokenUsage(store, id, tokenUsage);
        } else if (
          body.clearPendingPlan === true ||
          Object.prototype.hasOwnProperty.call(body, 'pendingPlan')
        ) {
          const thread = store.threads.find((t) => t.id === id);
          if (!thread) {
            sendJson(res, 404, { error: 'thread_not_found' });
            return;
          }
          store = upsertThreadMessages(store, id, thread.messages, {
            clearPendingPlan: body.clearPendingPlan === true,
            ...(Object.prototype.hasOwnProperty.call(body, 'pendingPlan')
              ? { pendingPlan: body.pendingPlan }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(
              body,
              'pendingPlanStrategy',
            )
              ? { pendingPlanStrategy: body.pendingPlanStrategy }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(body, 'pendingTaskList')
              ? { pendingTaskList: body.pendingTaskList }
              : {}),
          });
        } else {
          sendJson(res, 400, { error: 'messages_or_tokenUsage_required' });
          return;
        }
        saveHistory(cwd, store);
        sendJson(res, 200, store);
        return;
      }

      if (method === 'GET' && path === '/v1/index/status') {
        if (!requireAuth(req, res, token)) return;
        sendJson(res, 200, getIndexStatus(cwd));
        return;
      }

      if (method === 'POST' && path === '/v1/index/pause') {
        if (!requireAuth(req, res, token)) return;
        sendJson(res, 200, pauseWorkspaceIndex());
        return;
      }

      if (method === 'POST' && path === '/v1/index/reindex') {
        if (!requireAuth(req, res, token)) return;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const maximumFiles =
          typeof body.maximumFiles === 'number' && body.maximumFiles > 0
            ? Math.floor(body.maximumFiles)
            : undefined;
        const semantic = body.semanticIndex as
          | {
              enabled?: boolean;
              source?: string;
              model?: string;
              dimensions?: number;
              normalized?: boolean;
              baseUrl?: string;
            }
          | undefined;
        const stream =
          body.stream === true ||
          String(req.headers.accept ?? '').includes(
            'application/x-ndjson',
          );
        const force = body.force === true;
        const concurrency =
          typeof body.concurrency === 'number' && body.concurrency > 0
            ? Math.min(32, Math.floor(body.concurrency))
            : resolveDesktopIndexConcurrency();
        const filePaths = Array.isArray(body.filePaths)
          ? body.filePaths.filter(
              (p): p is string => typeof p === 'string' && p.length > 0,
            )
          : undefined;
        const semanticIndex = semantic
          ? {
              enabled: semantic.enabled !== false,
              source: semantic.source as never,
              model: semantic.model ?? '',
              dimensions: semantic.dimensions ?? 0,
              normalized: semantic.normalized !== false,
              baseUrl: semantic.baseUrl ?? process.env.MITII_BASE_URL ?? '',
              apiKey: process.env.MITII_API_KEY,
            }
          : {
              enabled: true,
              source: 'bundled' as const,
              model: '',
              dimensions: 0,
              normalized: true,
              baseUrl: '',
            };

        if (stream) {
          res.writeHead(200, {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
          const writeLine = (obj: unknown) => {
            if (res.writableEnded) return;
            try {
              res.write(`${JSON.stringify(obj)}\n`);
            } catch {
              /* client gone */
            }
          };
          try {
            const result = await reindexWorkspace({
              workspaceRoot: cwd,
              maximumFiles,
              concurrency,
              force,
              ...(filePaths?.length ? { filePaths } : {}),
              semanticIndex,
              onProgress: (progress) => {
                writeLine({
                  type: 'progress',
                  stage: progress.stage,
                  message: progress.message,
                  percent: progress.percent,
                  fileCount: progress.fileCount,
                  lexicalReady: progress.lexicalReady,
                  embeddingPhase: progress.embeddingPhase,
                });
              },
            });
            writeLine({
              type: 'result',
              ...result,
              statusSnapshot: getIndexStatus(cwd),
            });
          } catch (error) {
            writeLine({
              type: 'error',
              message:
                error instanceof Error ? error.message : String(error),
              statusSnapshot: getIndexStatus(cwd),
            });
          }
          res.end();
          return;
        }

        try {
          const result = await reindexWorkspace({
            workspaceRoot: cwd,
            maximumFiles,
            concurrency,
            force,
            ...(filePaths?.length ? { filePaths } : {}),
            semanticIndex,
          });
          sendJson(res, 200, { ...result, statusSnapshot: getIndexStatus(cwd) });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendJson(res, 500, {
            op: 'error',
            error: 'internal',
            message,
            statusSnapshot: getIndexStatus(cwd),
          });
        }
        return;
      }

      if (method === 'GET' && path === '/v1/evidence/session-log/latest') {
        if (!requireAuth(req, res, token)) return;
        const latest = findLatestSessionLog(cwd);
        if (!latest) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        sendJson(res, 200, { path: latest });
        return;
      }

      if (method === 'POST' && path === '/v1/evidence/session-log/export') {
        if (!requireAuth(req, res, token)) return;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const fallback =
          resolveLogsDir(undefined, process.env) ?? join(cwd, '.mitii', 'logs');
        const outPath = writeSessionExport(
          cwd,
          fallback,
          body.payload ?? body,
        );
        sendJson(res, 200, { path: outPath });
        return;
      }

      if (method === 'POST' && path === '/v1/evidence/shareable-diagnostic') {
        if (!requireAuth(req, res, token)) return;
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const settings = readDesktopSettingsJson(process.env);
        const developer = settings?.developer as
          | Record<string, unknown>
          | undefined;
        const fallback =
          resolveLogsDir(undefined, process.env) ?? join(cwd, '.mitii', 'logs');
        const written = writeShareableDiagnostic({
          workspaceRoot: cwd,
          fallbackDir: fallback,
          meta: {
            providerType:
              typeof body.providerType === 'string'
                ? body.providerType
                : process.env.MITII_PROVIDER,
            model:
              typeof body.model === 'string'
                ? body.model
                : process.env.MITII_MODEL,
            baseUrl:
              typeof body.baseUrl === 'string'
                ? body.baseUrl
                : process.env.MITII_BASE_URL,
            mode: typeof body.mode === 'string' ? body.mode : undefined,
            developerEnabled: developer?.enabled === true,
            modelIoEnabled: developer?.modelIo === true,
            contextWindowTokens:
              typeof body.contextWindowTokens === 'number'
                ? body.contextWindowTokens
                : undefined,
          },
        });
        sendJson(res, 200, written);
        return;
      }

      if (method === 'POST' && path === '/v1/evidence/audit-pack') {
        if (!requireAuth(req, res, token)) return;
        const logsDir =
          resolveLogsDir(undefined, process.env) ?? join(cwd, '.mitii', 'logs');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const auditDir = join(logsDir, `audit-${stamp}`);
        mkdirSync(auditDir, { recursive: true });
        const copied: string[] = [];
        const candidates = [
          findLatestSessionLog(cwd),
          findLatestModelIoLog(cwd),
        ].filter((p): p is string => Boolean(p));
        // Also include newest shareable diagnostic if present.
        try {
          const names = readdirSync(logsDir)
            .filter((name) => name.startsWith('shareable-diagnostic-'))
            .sort();
          const last = names[names.length - 1];
          if (last) candidates.push(join(logsDir, last));
        } catch {
          /* ignore */
        }
        for (const src of candidates) {
          try {
            const dest = join(auditDir, basename(src));
            copyFileSync(src, dest);
            copied.push(dest);
          } catch {
            /* skip missing */
          }
        }
        sendJson(res, 200, { path: auditDir, copied });
        return;
      }

      sendJson(res, 404, { op: 'error', error: 'not_found' });
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        sendJson(res, 500, { op: 'error', error: 'internal', message });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('engine_bind_failed');
  }

  const url = `http://${host}:${address.port}`;
  if (!isAllowedEngineBaseUrl(url)) {
    server.close();
    throw new Error(`engine_url_not_allowed:${url}`);
  }

  return {
    url,
    host,
    port: address.port,
    token,
    close: () =>
      new Promise((resolve, reject) => {
        incrementalIndex.dispose();
        workspaceWatcher.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
