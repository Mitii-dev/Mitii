import {
  MemoryPipeline,
  type MitiiClient,
  type MitiiConversationMessage,
  type MitiiResumeInput,
  type PlanArtifact,
  type PlanStrategyDecision,
  type RunEvent,
  type TaskList,
} from '@mitii/sdk';
import {
  formatEnvironmentDetailsBlock,
  isModelIoLoggingEnabled,
  type MemoryCaptureContext,
  observeRunToolEvent,
  openModelIoLog,
  openSessionLog,
  prepareStartInput,
  setActiveModelIoSink,
} from '@mitii/host';
import type * as vscode from 'vscode';

import { resolveApprovalPolicy as resolveApprovalPolicyFromModule } from './approvalPolicy.js';
import { collectVsCodeEnvironmentSnapshot } from './collectEnvironmentDetails.js';
import { mergePromptBudgetIntoBreakdown } from './contextUsage.js';
import { ensureRepositoryStateForAsk } from './hostAskAutoIndex.js';
import { prepareHostAskContext } from './hostAskContextPrep.js';
import {
  eventAtMs,
  formatClock,
  formatRunEventLine,
  nextActivityEventId,
  runEventToActivity,
} from './hostAskEvents.js';
import {
  resolveLogVerbosity,
  resolveRunBudget,
  withCurrentApprovalPolicy,
} from './hostAskSettings.js';
import {
  buildStopResumeFromSuspension,
  resolveSuspensionNative,
  resultToSuspension,
  type HostAskHandlers,
  type HostAskOutcome,
} from './hostAskSuspension.js';
import { readLoopPolicyThresholdOverrides } from './loopPolicySettings.js';
import { createVsCodeMemoryStore } from './memoryStore.js';
import { readModelIoLoggingEnabled } from './modelIoSettings.js';
import {
  formatContextInspection,
  formatDiffReview,
  formatRunDiagnostics,
  formatUsageLine,
  formatVisibleFailureDetails,
} from './runReport.js';
import { readV8LoopPolicyThresholdOverrides } from './v8LoopPolicySettings.js';

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

export function resolveApprovalPolicy(preset: string | undefined): {
  approvalMode: 'never' | 'when_required' | 'every_mutation';
  planApproval: 'policy' | 'never';
} {
  return resolveApprovalPolicyFromModule(preset);
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
  mode?: 'ask' | 'plan' | 'agent' | 'database';
  depth?: string;
  effort?: string;
  approvalMode?: string;
  pinnedPaths?: string[];
  requiredSkillIds?: string[];
  /** Skills that must not be auto-matched for this run. */
  excludedSkillIds?: string[];
  /** Attached MCP server ids for this turn (@mcp: / host pin). */
  requiredMcpServerIds?: string[];
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
  const {
    cfg,
    toggles,
    pinnedPaths,
    prompt,
    contextWindow,
    maximumOutputTokens,
    windowBudgetPolicy,
    budgetPreview,
    contextBreakdown: initialContextBreakdown,
  } = await prepareHostAskContext({
    vs,
    workspaceRoot,
    channel,
    prompt: options.prompt,
    depth: options.depth,
    pinnedPaths: options.pinnedPaths,
    workspaceId: options.workspaceId,
    workspaceState: options.workspaceState,
    conversationText: options.conversationText,
    conversation: options.conversation,
    handlers,
  });
  let contextBreakdown = initialContextBreakdown;

  await ensureRepositoryStateForAsk({
    client,
    workspaceRoot,
    workspaceId: options.workspaceId,
    channel,
    vs,
    secrets: options.secrets,
  });

  const execute = async (
    token: vscode.CancellationToken,
  ): Promise<HostAskOutcome> => {
    const runStartedAt = new Date().toISOString();
    const loopPolicyThresholds = readLoopPolicyThresholdOverrides(cfg);
    const v8LoopPolicyThresholds = readV8LoopPolicyThresholdOverrides(cfg);
    const effort =
      options.effort === 'low' ||
      options.effort === 'high' ||
      options.effort === 'medium'
        ? options.effort
        : undefined;
    const explorationDepth =
      options.depth === 'quick' ||
      options.depth === 'auto' ||
      options.depth === 'deep'
        ? options.depth
        : undefined;
    const userRulesEnabled =
      cfg.get<boolean>('safety.userRulesEnabled') === true;
    const approvalPreset =
      options.approvalMode ??
      cfg.get<string>('safety.approvalMode') ??
      'guided';

    const prepared = await prepareStartInput({
      prompt,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      uiMode: options.mode ?? 'ask',
      approvalPreset,
      userSafety: userRulesEnabled ? 'disk' : 'off',
      projectRulesBudget: {
        maxRuleChars: budgetPreview.injectionProjectRuleChars,
        maxTotalChars: budgetPreview.injectionProjectRulesTotalChars,
      },
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(explorationDepth ? { explorationDepth } : {}),
      ...(effort ? { effort } : {}),
      budget: resolveRunBudget(vs),
      ...(windowBudgetPolicy
        ? { windowBudgetPolicy: windowBudgetPolicy as Record<string, number> }
        : {}),
      // Raw settings value (0 = derive). Engine must not see a pre-derived
      // capability number as a host override.
      maximumOutputTokens,
      ...(loopPolicyThresholds
        ? { loopPolicy: { thresholds: loopPolicyThresholds } }
        : {}),
      ...(v8LoopPolicyThresholds
        ? { v8LoopPolicy: { thresholds: v8LoopPolicyThresholds } }
        : {}),
      ...(pinnedPaths.length > 0 ? { pinnedPaths } : {}),
      ...(options.requiredSkillIds && options.requiredSkillIds.length > 0
        ? { requiredSkillIds: options.requiredSkillIds }
        : {}),
      ...(options.excludedSkillIds && options.excludedSkillIds.length > 0
        ? { excludedSkillIds: options.excludedSkillIds }
        : {}),
      ...(options.requiredMcpServerIds &&
      options.requiredMcpServerIds.length > 0
        ? { requiredMcpServerIds: options.requiredMcpServerIds }
        : {}),
      ...(options.conversation && options.conversation.length > 0
        ? { conversation: options.conversation }
        : {}),
      ...(options.approvedPlan ? { approvedPlan: options.approvedPlan } : {}),
      ...(options.approvedPlanStrategy
        ? { approvedPlanStrategy: options.approvedPlanStrategy }
        : {}),
      ...(options.taskList ? { taskList: options.taskList } : {}),
      logVerbosity: resolveLogVerbosity(vs),
    });

    const effectiveMode = prepared.effectiveMode;
    const modeReminder = prepared.meta.usedDatabaseOverlay
      ? `Database (${effectiveMode})`
      : prepared.meta.usedModeProfileName
        ? `${prepared.meta.usedModeProfileName} (${effectiveMode})`
        : effectiveMode;
    const environmentBlock = formatEnvironmentDetailsBlock(
      collectVsCodeEnvironmentSnapshot({
        workspaceRoot,
        modeReminder,
      }),
    );
    const startInput = environmentBlock
      ? {
          ...prepared.start,
          environment: [
            environmentBlock,
            ...(prepared.start.environment ?? []),
          ],
        }
      : prepared.start;

    let run = client.start(startInput);
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
      mode: effectiveMode,
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
          const stopResume = buildStopResumeFromSuspension(result);
          if (stopResume) {
            channel.appendLine('[mitii] finishing suspended run…');
            run = client.resume(withCurrentApprovalPolicy(vs, stopResume));
            continue;
          }
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
