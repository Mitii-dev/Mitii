import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentRunBudget,
  type MitiiClient,
  type MitiiConversationMessage,
  type MitiiResumeInput,
  type PlanArtifact,
  type PlanStrategyDecision,
  type RunEvent,
  type TaskList,
} from '@mitii/sdk';
import { loadUserSafetyRules } from '@mitii/host';
import type * as vscode from 'vscode';

import { formatDiagnosticsPromptBlock } from './context/diagnosticsContext.js';
import { captureEditorContext } from './context/editorContext.js';
import {
  buildContextUsageBreakdown,
  mergePromptBudgetIntoBreakdown,
} from './contextUsage.js';
import {
  readContextToggles,
  resolveIntentLiteContextToggles,
} from './contextToggles.js';
import { getSharedMcpManager } from './mcp/manager.js';
import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';
import { createVsCodeMemoryStore, estimateMemoryPromptBlock } from './memoryStore.js';
import { scaffoldMitiiWorkspace } from './mitiiWorkspace.js';
import { resolveVsCodeSemanticIndexSettings } from './semanticIndex.js';
import { buildReviewDiff } from './reviewDiff.js';
import {
  resolveApprovalPolicy as resolveApprovalPolicyFromModule,
} from './approvalPolicy.js';
import {
  formatContextInspection,
  formatDiffReview,
  formatVisibleFailureDetails,
  formatRunDiagnostics,
  formatUsageLine,
} from './runReport.js';
import { openSessionLog } from './sessionLog.js';
import {
  isModelIoLoggingEnabled,
  openModelIoLog,
  setActiveModelIoSink,
} from './modelIoLog.js';
import { readModelIoLoggingEnabled } from './modelIoSettings.js';
import { deriveLiveTokenBudgetPreview } from './liveTokenBudgetPreview.js';
import { readTokenBudgetPolicyOverrides } from './tokenBudgetSettings.js';
import { readLoopPolicyThresholdOverrides } from './loopPolicySettings.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';
import {
  loadProjectRules,
  observeRunToolEvent,
  enrichFingerprintWithPersistedVectorProfile,
  type MemoryCaptureContext,
} from '@mitii/host';
import {
  normalizeMaximumOutputTokens,
  resolveEffectiveContextWindow,
} from './settingsFields.js';
import { MemoryPipeline } from '@mitii/v8';

export {
  formatRunEventLine,
  nextActivityEventId,
  runEventToActivity,
} from './hostAskEvents.js';

export {
  composePrompt,
  resultToSuspension,
  type HostAskHandlers,
  type HostAskOutcome,
} from './hostAskSuspension.js';

import {
  composePrompt,
  readPinnedFileContents,
  resolveSuspensionNative,
  resultToSuspension,
  type HostAskHandlers,
  type HostAskOutcome,
} from './hostAskSuspension.js';
import {
  eventAtMs,
  formatClock,
  formatRunEventLine,
  nextActivityEventId,
  runEventToActivity,
} from './hostAskEvents.js';

export function resolveApprovalPolicy(preset: string | undefined): {
  approvalMode: 'never' | 'when_required' | 'every_mutation';
  planApproval: 'policy' | 'never';
} {
  return resolveApprovalPolicyFromModule(preset);
}

function withCurrentApprovalPolicy(
  vs: typeof vscode,
  resume: MitiiResumeInput,
): MitiiResumeInput {
  const preset =
    vs.workspace.getConfiguration('mitii').get<string>('safety.approvalMode') ??
    'guided';
  return {
    ...resume,
    approvalMode: resolveApprovalPolicy(preset).approvalMode,
  };
}

function resolveRunBudget(vs: typeof vscode): AgentRunBudget {
  const cfg = vs.workspace.getConfiguration('mitii');
  if (cfg.get<boolean>('runBudget.unlimited') ?? false) {
    return {
      unlimited: true,
      maxModelCalls: 1_000_000,
      maxToolCalls: 1_000_000,
      maxLoopIterations: 1_000_000,
      maxWallTimeMs: 365 * 24 * 60 * 60 * 1000,
    };
  }
  const readPositive = (key: string, fallback: number): number => {
    const value = cfg.get<number>(key);
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return fallback;
  };
  return {
    maxModelCalls: readPositive('runBudget.maxModelCalls', 64),
    maxToolCalls: readPositive('runBudget.maxToolCalls', 128),
    maxLoopIterations: readPositive('runBudget.maxLoopIterations', 96),
    maxWallTimeMs:
      readPositive('runBudget.maxWallTimeMinutes', 30) * 60 * 1000,
  };
}

/** Developer-facing run-log detail level; see `mitii.logVerbosity` in package.json. */
function resolveLogVerbosity(
  vs: typeof vscode,
): 'minimal' | 'standard' | 'verbose' {
  const value = vs.workspace
    .getConfiguration('mitii')
    .get<string>('logVerbosity');
  return value === 'minimal' || value === 'standard' || value === 'verbose'
    ? value
    : 'verbose';
}

/**
 * Run an ask through the SDK with OutputChannel streaming + optional UI hooks.
 */
export async function runAskInOutputChannel(options: {
  vs: typeof vscode;
  client: MitiiClient;
  prompt: string;
  workspaceRoot?: string;
  channel: vscode.OutputChannel;
  mode?: 'ask' | 'plan' | 'agent';
  depth?: string;
  effort?: string;
  approvalMode?: string;
  pinnedPaths?: string[];
  requiredSkillIds?: string[];
  workspaceId?: string;
  /** Used to estimate memory tokens in the context meter (not prompt-stuffed). */
  workspaceState?: vscode.Memento;
  /** Secret storage for embedding provider API keys during auto-index. */
  secrets?: vscode.SecretStorage;
  /** Stable chat/session id used to group JSONL logs. */
  sessionId?: string;
  /** Prior chat text for conversation token estimate. */
  conversationText?: string;
  /** Prior user/assistant turns carried into the engine. */
  conversation?: MitiiConversationMessage[];
  /** Structured plan handoff for agent execution. */
  approvedPlan?: PlanArtifact;
  /** Strategy for a host-carried approved plan. */
  approvedPlanStrategy?: PlanStrategyDecision;
  /** Live working checklist carried across Agent turns. */
  taskList?: TaskList;
  handlers?: HostAskHandlers;
}): Promise<HostAskOutcome> {
  const { vs, client, workspaceRoot, channel, handlers } = options;
  const toggles = resolveIntentLiteContextToggles({
    toggles: readContextToggles(vs),
    depth: options.depth,
    prompt: options.prompt,
  });
  const editor = toggles.editor
    ? captureEditorContext(vs, workspaceRoot, {
        includeOpenTabs: toggles.openTabs,
      })
    : undefined;
  const diagnosticsBlock = toggles.diagnostics
    ? formatDiagnosticsPromptBlock(vs, workspaceRoot)
    : '';
  // Explicit user pins only — do not auto-promote the active editor into pinned.
  const pinnedPaths = [...(options.pinnedPaths ?? [])];
  const hasPinnedContext = pinnedPaths.length > 0;

  let repoMapBlock: string | undefined;
  // Pinned files take priority. Only attach a workspace outline when there are
  // no pins, or when the user explicitly asked for deep context.
  const includeRepoMap =
    toggles.repoMap &&
    workspaceRoot &&
    (!hasPinnedContext || options.depth === 'deep');
  if (includeRepoMap) {
    try {
      const maxFiles = hasPinnedContext ? 60 : 200;
      const snap = await buildWorkspaceSnapshot({
        workspaceRoot,
        workspaceId: options.workspaceId ?? 'vscode_workspace',
        maxFiles,
      });
      const listed = snap.relativePaths.slice(0, maxFiles);
      repoMapBlock = `Workspace file map (${snap.fileCount} files${
        snap.truncated ? ', truncated' : ''
      }${hasPinnedContext ? '; supplementary — pinned files take priority' : ''}):\n${listed
        .map((p) => `- ${p}`)
        .join('\n')}`;
    } catch (error) {
      channel.appendLine(
        `[context] repo map failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let gitDiffBlock: string | undefined;
  if (toggles.gitDiff && workspaceRoot) {
    try {
      const review = await buildReviewDiff(workspaceRoot);
      const fileLines = review.files
        .slice(0, 40)
        .map((f) => `- ${f.status} ${f.path}`)
        .join('\n');
      gitDiffBlock = [
        `Git status: ${review.summary}`,
        fileLines ? `Changed files:\n${fileLines}` : undefined,
        review.patchPreview ? `Diff stat:\n${review.patchPreview}` : undefined,
      ]
        .filter(Boolean)
        .join('\n\n');
    } catch (error) {
      channel.appendLine(
        `[context] git diff failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const pinnedContents =
    workspaceRoot && pinnedPaths.length
      ? readPinnedFileContents(workspaceRoot, pinnedPaths)
      : undefined;

  const prompt = composePrompt({
    prompt: options.prompt,
    pinnedPaths,
    pinnedContents: pinnedContents || undefined,
    editorBlock: editor?.promptBlock,
    diagnosticsBlock: diagnosticsBlock || undefined,
    repoMapBlock,
    gitDiffBlock,
  });

  const cfg = vs.workspace.getConfiguration('mitii');
  const approvalPolicy = resolveApprovalPolicy(
    options.approvalMode ??
      cfg.get<string>('safety.approvalMode') ??
      'guided',
  );
  const model = cfg.get<string>('provider.model') ?? '';
  const providerType = cfg.get<string>('provider.type') ?? '';
  const storedContextWindow = cfg.get<number>('provider.contextWindow');
  const contextWindow = resolveEffectiveContextWindow(
    typeof storedContextWindow === 'number' && Number.isFinite(storedContextWindow)
      ? Math.floor(storedContextWindow)
      : 0,
    model,
    providerType,
  );
  const maximumOutputTokens = normalizeMaximumOutputTokens(
    cfg.get<number>('provider.maximumOutputTokens'),
  );
  const mcpCatalogTokens = getSharedMcpManager().snapshot().toolsCatalogTokens;
  const memoryBlock =
    toggles.memory && options.workspaceState && options.workspaceId
      ? await estimateMemoryPromptBlock(
          options.workspaceState,
          options.workspaceId,
        )
      : undefined;
  const windowBudgetPolicy = readTokenBudgetPolicyOverrides(cfg);
  const budgetPreview = deriveLiveTokenBudgetPreview({
    contextWindowTokens: contextWindow,
    maximumOutputTokens:
      maximumOutputTokens > 0 ? maximumOutputTokens : undefined,
    policy: windowBudgetPolicy,
  });
  let contextBreakdown = buildContextUsageBreakdown({
    prompt: options.prompt,
    conversationText: options.conversationText,
    pinnedContents: pinnedContents || undefined,
    memoryBlock,
    editorBlock: editor?.promptBlock,
    diagnosticsBlock: diagnosticsBlock || undefined,
    gitDiffBlock,
    repoMapBlock,
    mcpToolsCatalogTokens: mcpCatalogTokens,
    depthHint: options.depth,
    contextWindow,
    preview: budgetPreview,
  });
  handlers?.onContextBreakdown?.(contextBreakdown);

  channel.show(true);
  channel.appendLine(`> ${options.prompt}`);
  if (options.conversation && options.conversation.length > 0) {
    channel.appendLine(
      `[context] conversation carry: ${options.conversation.length} prior turn(s)`,
    );
  } else {
    channel.appendLine('[context] conversation carry: none (first turn or empty history)');
  }

  const emitHostNote = (line: string, title: string, detail?: string) => {
    channel.appendLine(line);
    handlers?.onEvent?.(undefined, {
      id: nextActivityEventId(),
      at: Date.now(),
      kind: 'context',
      title,
      detail,
    });
  };

  if (editor?.activeRelPath) {
    emitHostNote(
      `[context] activeEditor=@${editor.activeRelPath}`,
      'Attached active editor',
      `@${editor.activeRelPath}`,
    );
  }
  if (diagnosticsBlock) {
    emitHostNote(
      '[context] diagnostics attached',
      'Attached diagnostics',
      'workspace problems',
    );
  }
  if (repoMapBlock) {
    const fileCountMatch = /Workspace file map \((\d+) files/.exec(repoMapBlock);
    const fileCount = fileCountMatch?.[1];
    emitHostNote(
      '[context] repo map attached',
      'Attached workspace map',
      fileCount ? `${fileCount} file paths` : 'file path list',
    );
  }
  if (gitDiffBlock) {
    emitHostNote(
      '[context] git diff attached',
      'Attached git status',
      'changed files + diff summary',
    );
  }
  if (pinnedContents) {
    emitHostNote(
      `[context] pinned file contents (${pinnedPaths.length})`,
      pinnedPaths.length === 1 ? 'Read pinned file' : 'Read pinned files',
      pinnedPaths.map((p) => `@${p}`).join(', '),
    );
  }

  // Ensure repository state exists so context/tool routes can pin.
  if (workspaceRoot) {
    try {
      const latest = await client.getLatestRepositoryState(
        options.workspaceId ?? 'vscode_workspace',
      );
      if (!latest) {
        const workspaceId = options.workspaceId ?? 'vscode_workspace';
        const mitiiDir = scaffoldMitiiWorkspace(workspaceRoot);
        const sqlitePath = join(mitiiDir, 'repository-index.sqlite');
        if (existsSync(sqlitePath)) {
          const statePath = join(mitiiDir, 'last-repository-state.json');
          let publishedFromCache = false;
          if (existsSync(statePath)) {
            try {
              const raw = JSON.parse(readFileSync(statePath, 'utf8')) as {
                schemaVersion?: number;
                snapshotId?: string;
                roots?: Array<{ vectorProfile?: string }>;
                scanCompleteness?: 'complete' | 'truncated' | 'unknown';
                reasons?: Array<{
                  code: string;
                  message: string;
                  rootId?: string;
                }>;
              };
              const hasVectorProfile = raw.roots?.some(
                (root) => typeof root.vectorProfile === 'string' && root.vectorProfile.trim(),
              );
              if (
                raw.schemaVersion === 1 &&
                typeof raw.snapshotId === 'string' &&
                Array.isArray(raw.roots) &&
                raw.roots.length > 0 &&
                hasVectorProfile
              ) {
                await client.publishRepositoryState({
                  schemaVersion: 1,
                  workspaceId,
                  snapshotId: raw.snapshotId,
                  roots: raw.roots as never,
                  scanCompleteness: raw.scanCompleteness ?? 'complete',
                  reasons: (raw.reasons ?? []) as never,
                  generatedAt: new Date().toISOString(),
                });
                publishedFromCache = true;
                channel.appendLine(
                  `[index] reused on-disk index via last-repository-state.json (${raw.roots.length} root(s); vector profile preserved)`,
                );
              }
            } catch (error) {
              channel.appendLine(
                `[index] last-repository-state.json unusable; falling back to fingerprint pin: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
          if (!publishedFromCache) {
            const snap = await buildWorkspaceSnapshot({
              workspaceRoot,
              workspaceId,
            });
            const candidate = enrichFingerprintWithPersistedVectorProfile(
              snap.candidate,
              mitiiDir,
            );
            await client.publishRepositoryState(candidate);
            channel.appendLine(
              `[index] reused on-disk index at ${sqlitePath}; published fingerprint pin (${snap.fileCount} files)${
                candidate.roots.some(
                  (root: { vectorProfile?: string }) => root.vectorProfile,
                )
                  ? ' with persisted vector profile'
                  : ''
              }`,
            );
          }
        } else {
          try {
            const full = await runFullWorkspaceIndex({
              mitiiDir,
              workspaceRoot,
              workspaceId,
              ...(options.secrets
                ? {
                    semanticIndex: await resolveVsCodeSemanticIndexSettings(
                      vs,
                      options.secrets,
                    ),
                  }
                : {}),
            });
            await client.publishRepositoryStateFromIndexing(full.indexing, {
              catalogRevisionByRoot: full.catalogRevisionByRoot,
              graphRevisionByRoot: full.graphRevisionByRoot,
              mapRevisionByRoot: full.mapRevisionByRoot,
            });
            channel.appendLine(
              `[index] auto-published full index (${full.fileCount} files); vector=${full.vectorIndex.status}${full.vectorIndex.reason ? ` reason=${full.vectorIndex.reason}` : ''}`,
            );
          } catch (fullIndexError) {
            const snap = await buildWorkspaceSnapshot({
              workspaceRoot,
              workspaceId,
            });
            await client.publishRepositoryState(snap.candidate);
            channel.appendLine(
              `[index] auto-published host snapshot (${snap.fileCount} files; full index unavailable: ${
                fullIndexError instanceof Error
                  ? fullIndexError.message
                  : String(fullIndexError)
              })`,
            );
          }
        }
      }
    } catch (error) {
      channel.appendLine(
        `[index] auto-publish skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const execute = async (
    token: vscode.CancellationToken,
  ): Promise<HostAskOutcome> => {
    const projectRules = workspaceRoot
      ? await loadProjectRules({ workspaceRoot })
      : [];
    const runStartedAt = new Date().toISOString();
    const loopPolicyThresholds = readLoopPolicyThresholdOverrides(cfg);
    const effort =
      options.effort === 'low' ||
      options.effort === 'high' ||
      options.effort === 'medium'
        ? options.effort
        : undefined;
    const userRulesEnabled =
      cfg.get<boolean>('safety.userRulesEnabled') === true;
    const userSafetyRules = userRulesEnabled && workspaceRoot
      ? loadUserSafetyRules(workspaceRoot)
      : undefined;
    let run = client.start({
      prompt,
      mode: options.mode ?? 'ask',
      workspaceRoot,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      approvalMode: approvalPolicy.approvalMode,
      planApproval: approvalPolicy.planApproval,
      ...(userSafetyRules?.enabled ? { userSafetyRules } : {}),
      budget: resolveRunBudget(vs),
      windowBudget: {
        ...(windowBudgetPolicy ? { policy: windowBudgetPolicy } : {}),
        ...(effort ? { effort } : {}),
        // Raw settings value (0 = derive). Engine must not see a pre-derived
        // capability number as a host override.
        maximumOutputTokens,
      },
      ...(loopPolicyThresholds
        ? { loopPolicy: { thresholds: loopPolicyThresholds } }
        : {}),
      ...(projectRules.length > 0 ? { projectRules: [...projectRules] } : {}),
      ...(pinnedPaths.length > 0 ? { pinnedPaths } : {}),
      ...(options.requiredSkillIds && options.requiredSkillIds.length > 0
        ? { requiredSkillIds: [...options.requiredSkillIds] }
        : {}),
      ...(options.conversation && options.conversation.length > 0
        ? { conversation: options.conversation }
        : {}),
      ...(options.approvedPlan ? { approvedPlan: options.approvedPlan } : {}),
      ...(options.approvedPlanStrategy
        ? { approvedPlanStrategy: options.approvedPlanStrategy }
        : {}),
      ...(options.taskList ? { taskList: options.taskList } : {}),
      ...(options.depth ? { explorationDepth: options.depth } : {}),
      logVerbosity: resolveLogVerbosity(vs),
    });
    const events: RunEvent[] = [];
    const memoryCapture: MemoryCaptureContext | undefined =
      toggles.memory &&
      workspaceRoot &&
      options.workspaceState &&
      options.workspaceId
        ? {
            workspaceRoot,
            workspaceId: options.workspaceId,
            pipeline: new MemoryPipeline({
              store: createVsCodeMemoryStore(
                options.workspaceState,
                options.workspaceId,
              ),
            }),
          }
        : undefined;
    const sessionLog = openSessionLog(workspaceRoot, {
      at: runStartedAt,
      prompt: options.prompt,
      mode: options.mode,
      conversationCount: options.conversation?.length ?? 0,
      sessionId: options.sessionId,
      runId: run.runId,
      contextWindowTokens: contextWindow,
      maximumOutputTokens,
    });
    const logPath = sessionLog?.path;
    if (logPath) {
      channel.appendLine(`[log] ${logPath}`);
    }

    const modelIoEnabled = isModelIoLoggingEnabled(
      cfg.get<boolean>('developer.enabled') ?? false,
      readModelIoLoggingEnabled(cfg),
    );
    const modelIoLog = modelIoEnabled
      ? openModelIoLog(workspaceRoot, {
          at: runStartedAt,
          sessionId: options.sessionId,
          runId: run.runId,
        })
      : undefined;
    if (modelIoLog) {
      setActiveModelIoSink(modelIoLog);
      channel.appendLine(`[model-io] ${modelIoLog.path}`);
    }

    try {
      for (;;) {
      const cancelSub = token.onCancellationRequested(() => {
        channel.appendLine('[mitii] cancelling…');
        run.cancel('user_cancelled');
      });

      try {
        for await (const event of run.events) {
          events.push(event);
          if (memoryCapture) {
            await observeRunToolEvent({
              event,
              capture: memoryCapture,
              userPrompt: options.prompt,
            });
          }
          sessionLog?.appendEvent(event);
          const activity = runEventToActivity(event);
          if (activity) {
            handlers?.onEvent?.(event, activity);
          }
          if (event.type === 'model_delta') {
            if (event.kind === 'content' && event.preview) {
              handlers?.onDelta?.(event.preview);
            }
          }
          if (event.type === 'prompt_ready' && event.budget) {
            contextBreakdown = mergePromptBudgetIntoBreakdown({
              host: contextBreakdown,
              budget: event.budget,
              window: event.window,
            });
            handlers?.onContextBreakdown?.(contextBreakdown);
          }
          const line = formatRunEventLine(event);
          if (line) {
            const stamp = formatClock(eventAtMs(event));
            if (event.type === 'model_delta') {
              channel.append(line);
            } else {
              channel.appendLine(`[${stamp}] ${line}`);
            }
          }
        }
        const result = await run.result;
        if (result.status !== 'suspended') {
          sessionLog?.finish(result);
          channel.appendLine('');
          for (const line of formatContextInspection(events)) {
            channel.appendLine(line);
          }
          for (const line of formatRunDiagnostics(result)) {
            channel.appendLine(line);
          }
          for (const line of formatDiffReview(result)) {
            channel.appendLine(line);
          }
          const usageLine = formatUsageLine(result);
          const statusLine = `[mitii] status=${result.status} route=${result.route ?? 'n/a'}`;
          channel.appendLine(usageLine);
          channel.appendLine(statusLine);
          for (const line of formatRunDiagnostics(result)) {
            handlers?.onEvent?.(undefined, {
              id: nextActivityEventId(),
              at: Date.now(),
              kind: result.status === 'budget_exhausted' ? 'warning' : 'info',
              title:
                result.status === 'budget_exhausted'
                  ? 'Budget exhausted'
                  : 'Run diagnostic',
              detail: line.replace(/^\[[^\]]+\]\s*/, '').slice(0, 400),
              status:
                result.status === 'budget_exhausted' ? 'failed' : result.status,
            });
          }
          if (result.error?.message && result.status !== 'budget_exhausted') {
            handlers?.onEvent?.(undefined, {
              id: nextActivityEventId(),
              at: Date.now(),
              kind: 'warning',
              title: 'Error',
              detail: result.error.message.slice(0, 400),
              status: 'failed',
            });
          }
          // Always last in the activity timeline so the usage/status line closes the run.
          handlers?.onEvent?.(undefined, {
            id: nextActivityEventId(),
            at: Date.now(),
            kind: 'info',
            title: 'Run summary',
            detail: `${usageLine.replace('[mitii] ', '')} · ${statusLine.replace('[mitii] ', '')}`,
            status: result.status,
          });
          return {
            result: {
              ...result,
              answer: `${result.answer ?? ''}${formatVisibleFailureDetails({
                result,
                events,
                sessionLogPath: logPath,
              })}`,
            },
            events,
            contextBreakdown,
            sessionLogPath: logPath,
          };
        }

        channel.appendLine('');
        for (const line of formatDiffReview(result)) {
          channel.appendLine(line);
        }
        channel.appendLine(
          `[mitii] suspended (${result.suspension?.kind ?? 'unknown'})`,
        );

        const payload = resultToSuspension(result);
        let resume: MitiiResumeInput | 'stop' = 'stop';
        if (payload && handlers?.onSuspended) {
          resume = await handlers.onSuspended(result, payload);
        } else {
          resume = await resolveSuspensionNative(vs, result);
        }
        if (resume === 'stop') {
          sessionLog?.finish(result);
          return {
            result,
            events,
            contextBreakdown,
            sessionLogPath: logPath,
          };
        }
        channel.appendLine('[mitii] resuming…');
        run = client.resume(withCurrentApprovalPolicy(vs, resume));
      } finally {
        cancelSub.dispose();
      }
    }
    } finally {
      setActiveModelIoSink(undefined);
      modelIoLog?.close();
    }
  };

  if (handlers?.cancelToken) {
    return execute(handlers.cancelToken);
  }

  return vs.window.withProgress(
    {
      location: vs.ProgressLocation.Notification,
      title: 'Mitii',
      cancellable: true,
    },
    async (_progress, token) => execute(token),
  );
}
