import {
  appendTurn,
  loadCheckpoints,
  saveCheckpoints,
  toThreadSummaries,
} from '../chatHistory.js';
import {
  compactActivityForHistory,
  compactFileChangesForHistory,
  enrichAssistantCarryText,
  resolveDisplayedAssistantText,
  type resolvePlanHandoff,
} from '../conversationCarry.js';
import { buildRunFileChangesView } from '../fileChanges.js';
import type { runAskInOutputChannel } from '../hostAsk.js';
import { runEventToActivity } from '../hostAsk.js';
import { planViewFromArtifact } from '../planView.js';
import { savePlanToWorkspace } from '../planStore.js';
import type { WebviewToHostMessage } from '../protocol.js';
import { saveTaskListToWorkspace } from '../taskStore.js';
import type { SidebarContext } from './context.js';
import { resolvePendingFixFindings } from './reviewFindingsSync.js';
import {
  formatDiagramCarryMarkdown,
  planFromAnswer,
  savedPlanMarkdownRelative,
} from './runPrompt.js';

export type AskMessage = Extract<WebviewToHostMessage, { type: 'ask' }>;
export type AskOutcome = Awaited<ReturnType<typeof runAskInOutputChannel>>;

export interface FinalizeRunInput {
  outcome: AskOutcome;
  message: AskMessage;
  prompt: string;
  llmPrompt: string;
  approvedPlan: ReturnType<typeof resolvePlanHandoff>;
}

/** Commit a finished run: usage, plan/task artifacts, file changes, history, checkpoint. */
export async function finalizeRun(
  ctx: SidebarContext,
  input: FinalizeRunInput,
): Promise<void> {
  const { outcome, message, prompt, llmPrompt, approvedPlan } = input;
  if (outcome.result.status === 'cancelled') {
    ctx.post({ type: 'run.cancelled' });
    ctx.session.pendingFixFindingKeys = [];
  }
  resolvePendingFixFindings(ctx, outcome.result.status);
  const usage = ctx.tokens.recordUsage(
    outcome.result,
    llmPrompt,
    outcome.contextBreakdown,
  );
  const answer = outcome.result.answer ?? '';
  const changedPaths = ctx.session.activeFileChangeSnapshot
    ? [...ctx.session.activeFileChangeSnapshot.mutatedPaths]
    : [];
  const diagramCarry =
    ctx.session.pendingMcpAppEvents.length > 0
      ? formatDiagramCarryMarkdown(ctx.session.pendingMcpAppEvents)
      : '';
  const enrichedAnswer = enrichAssistantCarryText({
    answer: answer.trim()
      ? answer
      : diagramCarry
        ? diagramCarry
        : outcome.result.error?.message
          ? `Error: ${outcome.result.error.message}`
          : `(${outcome.result.status})`,
    changedPaths,
  });
  const assistantTextRaw = resolveDisplayedAssistantText({
    streamedText: ctx.session.liveStreamText,
    finalAnswer: enrichedAnswer,
  });
  const assistantText =
    diagramCarry &&
    answer.trim() &&
    !assistantTextRaw.includes(diagramCarry)
      ? `${assistantTextRaw.trimEnd()}\n\n${diagramCarry}`
      : assistantTextRaw;
  ctx.session.lastAssistantText = assistantText;
  ctx.session.liveStreamText = '';
  const resultPlan = outcome.result.plan;
  const usedPlanHandoff = Boolean(approvedPlan);
  let savedPlanPath: string | undefined;
  if (resultPlan) {
    const root = ctx.effectiveRoot();
    if (root) {
      try {
        const saved = savePlanToWorkspace({
          workspaceRoot: root,
          plan: resultPlan,
          source:
            message.mode === 'plan'
              ? 'plan_mode'
              : approvedPlan
                ? 'plan_approval'
                : 'agent',
          threadId: ctx.session.activeThreadId,
        });
        savedPlanPath = savedPlanMarkdownRelative(saved.relativePath);
        ctx.channel.appendLine(`[plan] saved ${saved.relativePath}`);
      } catch (error) {
        ctx.channel.appendLine(
          `[plan] save failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  const plan =
    message.mode === 'plan'
      ? planViewFromArtifact(resultPlan, { savedPlanPath }) ??
        planFromAnswer(message.mode, answer)
      : approvedPlan
        ? planViewFromArtifact(approvedPlan, {
            savedPlanPath,
          })
        : resultPlan
          ? planViewFromArtifact(resultPlan, {
              savedPlanPath,
            })
          : null;
  if (outcome.result.taskList) {
    const root = ctx.effectiveRoot();
    const isDiscoveryTask =
      outcome.result.taskList.purpose === 'discovery' ||
      outcome.result.taskList.source === 'discovery';
    if (root && !isDiscoveryTask) {
      try {
        const saved = saveTaskListToWorkspace({
          workspaceRoot: root,
          taskList: outcome.result.taskList,
          threadId: ctx.session.activeThreadId,
        });
        ctx.channel.appendLine(`[tasks] saved ${saved.relativePath}`);
      } catch (error) {
        ctx.channel.appendLine(
          `[tasks] save failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const changeRoot = ctx.effectiveRoot();
  const runId = outcome.result.runId;
  let persistedFileChanges =
    changeRoot &&
    ctx.session.activeFileChangeSnapshot &&
    runId &&
    ctx.session.activeFileChangeSnapshot.mutatedPaths.size > 0
      ? buildRunFileChangesView({
          runId,
          workspaceRoot: changeRoot,
          snapshot: ctx.session.activeFileChangeSnapshot,
        })
      : null;
  persistedFileChanges =
    compactFileChangesForHistory(persistedFileChanges) ?? null;

  const activity = compactActivityForHistory([
    ...outcome.events
      .map((event) => runEventToActivity(event))
      .filter((event): event is NonNullable<typeof event> => Boolean(event)),
    ...ctx.session.pendingMcpAppEvents,
  ]);
  ctx.session.pendingMcpAppEvents = [];

  const pendingPlanForUi =
    message.mode === 'plan' && resultPlan && plan
      ? plan
      : usedPlanHandoff && outcome.result.status === 'completed'
        ? null
        : undefined;

  ctx.post({
    type: 'run.result',
    status: outcome.result.status,
    answer: assistantText,
    route: outcome.result.route ?? null,
    error: outcome.result.error?.message,
    usage,
    plan,
    ...(pendingPlanForUi !== undefined
      ? { pendingPlan: pendingPlanForUi }
      : {}),
  });

  if (persistedFileChanges && runId && ctx.session.activeFileChangeSnapshot) {
    ctx.session.fileChangeSnapshots.set(runId, ctx.session.activeFileChangeSnapshot);
    ctx.post({ type: 'run.fileChanges', changes: persistedFileChanges });
    ctx.channel.appendLine(
      `[file-changes] run=${runId} status=${outcome.result.status} files=${persistedFileChanges.files.length} +${persistedFileChanges.totalAdditions} -${persistedFileChanges.totalDeletions}`,
    );
  }
  ctx.session.activeFileChangeSnapshot = undefined;

  ctx.post({ type: 'tokenUsage', usage: ctx.tokens.usage });
  const store = await appendTurn(ctx.host.workspaceState, {
    threadId: ctx.session.activeThreadId,
    userText: prompt,
    assistantText,
    mode: message.mode,
    activity,
    ...(persistedFileChanges
      ? { fileChanges: persistedFileChanges }
      : {}),
    status: outcome.result.status,
    route: outcome.result.route ?? null,
    ...(message.mode === 'plan' && resultPlan
      ? {
          pendingPlan: resultPlan,
          pendingPlanStrategy: outcome.result.planStrategy ?? null,
        }
      : {}),
    ...(usedPlanHandoff && outcome.result.status === 'completed'
      ? { clearPendingPlan: true }
      : {}),
    pendingTaskList: outcome.result.taskList ?? null,
    tokenUsage: ctx.tokens.usage,
  });
  ctx.session.activeThreadId = store.activeThreadId;
  ctx.post({
    type: 'history',
    threads: toThreadSummaries(store),
    activeThreadId: store.activeThreadId,
  });
  // Snapshot a checkpoint label after successful runs
  if (outcome.result.status === 'completed') {
    const checkpoints = loadCheckpoints(ctx.host.workspaceState);
    checkpoints.unshift({
      id: `cp_${Date.now().toString(36)}`,
      label: `After: ${prompt.slice(0, 40)}`,
      createdAt: new Date().toISOString(),
      ...(changedPaths.length > 0 ? { changedPaths } : {}),
    });
    await saveCheckpoints(ctx.host.workspaceState, checkpoints.slice(0, 30));
    ctx.post({ type: 'setCheckpoints', checkpoints: checkpoints.slice(0, 30) });
  }
}

/** Persist a failed run as an error turn and surface it in the webview. */
export async function recordRunFailure(
  ctx: SidebarContext,
  error: unknown,
  message: AskMessage,
  prompt: string,
): Promise<void> {
  ctx.session.pendingFixFindingKeys = [];
  const text = error instanceof Error ? error.message : String(error);
  const assistantText = `Error: ${text}`;
  ctx.session.lastAssistantText = assistantText;
  ctx.post({ type: 'error', message: text });
  ctx.post({
    type: 'run.result',
    status: 'failed',
    answer: assistantText,
    error: text,
  });
  const store = await appendTurn(ctx.host.workspaceState, {
    threadId: ctx.session.activeThreadId,
    userText: prompt,
    assistantText,
    mode: message.mode,
  });
  ctx.session.activeThreadId = store.activeThreadId;
  ctx.post({
    type: 'history',
    threads: toThreadSummaries(store),
    activeThreadId: store.activeThreadId,
  });
}
