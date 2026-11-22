import {
  deriveLiveTokenBudgetPreview,
} from '@mitii/ui-core';

import {
  buildConversationCarry,
  collectStructuredCarryFromThread,
  resolvePlanHandoff,
  resolvePlanStrategyHandoff,
} from '../conversationCarry.js';
import { buildContextUsageBreakdown } from '../contextUsage.js';
import { readContextToggles } from '../contextToggles.js';
import {
  createFileChangeRunSnapshot,
  listDirtyGitPaths,
} from '../fileChanges.js';
import { runAskInOutputChannel } from '../hostAsk.js';
import { estimateMemoryPromptBlock } from '../memoryStore.js';
import { readTokenBudgetPolicyOverrides } from '../tokenBudgetSettings.js';
import { resolveContextWindow } from './configValues.js';
import type { SidebarContext } from './context.js';
import { ensureActiveThread } from './handlers/threadHandlers.js';
import { createRunHandlers } from './runHandlers.js';
import {
  type AskMessage,
  finalizeRun,
  recordRunFailure,
} from './runFinalize.js';
import { buildReviewLlmPrompt, prepareReviewPrompt } from './runPrompt.js';

/** Run one Ask / Plan / Agent / Review turn end to end. */
export async function handleAsk(
  ctx: SidebarContext,
  message: AskMessage,
): Promise<void> {
  const prompt = String(message.prompt ?? '').trim();
  if (!prompt) return;
  const activeThread = await ensureActiveThread(ctx, prompt);
  const mode =
    message.mode === 'review'
      ? 'ask'
      : message.mode === 'database'
        ? 'database'
        : (message.mode ?? 'ask');
  const engineMode =
    mode === 'plan' || mode === 'agent' || mode === 'database' ? mode : 'ask';
  const carryBudget = deriveLiveTokenBudgetPreview({
    contextWindowTokens: resolveContextWindow(ctx.vs),
    policy: readTokenBudgetPolicyOverrides(
      ctx.vs.workspace.getConfiguration('mitii'),
    ),
  });
  const conversation = buildConversationCarry({
    messages: (activeThread?.messages ?? []).map((m) => ({
      role: m.role,
      text: m.text,
    })),
    currentPrompt: prompt,
    mode: engineMode === 'database' ? 'ask' : engineMode,
    structured:
      engineMode === 'agent'
        ? collectStructuredCarryFromThread(activeThread ?? {})
        : undefined,
    limits: {
      maxMessages: carryBudget.carryMaxMessages,
      maxCharsPerMessage: carryBudget.carryMaxCharsPerMessage,
    },
  });
  const conversationText = conversation
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
  // Cancel any still-running prior run before disposing its token source —
  // otherwise the old run keeps executing in the background, orphaned and
  // undetectable, concurrently with the new one (they'd race on the same
  // workspace files and interleave in the same session log).
  ctx.session.runCancel?.cancel();
  ctx.session.runCancel?.dispose();
  ctx.session.liveApprovalMode = undefined;
  const cancelSource = new ctx.vs.CancellationTokenSource();
  ctx.session.runCancel = cancelSource;
  const llmPrompt =
    message.mode === 'review'
      ? await prepareReviewPrompt(ctx, buildReviewLlmPrompt(prompt))
      : prompt;
  ctx.post({ type: 'run.started', mode: message.mode, prompt });
  if (message.mode === 'review') {
    ctx.host.reviewFindings.beginRun();
    ctx.post({ type: 'setReviewFindings', findings: [] });
  }
  ctx.tokens.beginRun();
  ctx.session.pendingMcpAppEvents = [];
  ctx.session.liveStreamText = '';
  const contextWindow = resolveContextWindow(ctx.vs);
  const toggles = readContextToggles(ctx.vs);
  const memoryBlock = toggles.memory
    ? await estimateMemoryPromptBlock(
        ctx.host.workspaceState,
        ctx.getWorkspaceId(),
      )
    : undefined;
  const cfg = ctx.vs.workspace.getConfiguration('mitii');
  const configuredMaxOut = cfg.get<number>('provider.maximumOutputTokens');
  const maximumOutputTokens =
    typeof configuredMaxOut === 'number' &&
    Number.isFinite(configuredMaxOut) &&
    configuredMaxOut > 0
      ? Math.floor(configuredMaxOut)
      : undefined;
  const provisionalContextBreakdown = buildContextUsageBreakdown({
    prompt: llmPrompt,
    conversationText,
    memoryBlock,
    depthHint: message.depth,
    contextWindow,
    preview: deriveLiveTokenBudgetPreview({
      contextWindowTokens: contextWindow,
      maximumOutputTokens,
      policy: readTokenBudgetPolicyOverrides(cfg),
    }),
  });
  ctx.tokens.applyProvisionalBreakdown(
    provisionalContextBreakdown,
    contextWindow,
  );
  ctx.post({ type: 'tokenUsage', usage: ctx.tokens.usage });

  const workspaceRootForChanges = ctx.effectiveRoot();
  const preDirty = workspaceRootForChanges
    ? await listDirtyGitPaths(workspaceRootForChanges)
    : [];
  ctx.session.activeFileChangeSnapshot = createFileChangeRunSnapshot(preDirty);

  try {
    const client = await ctx.ensureClient();
    const approvedPlan = resolvePlanHandoff({
      mode: engineMode === 'database' ? 'ask' : engineMode,
      pendingPlan: activeThread?.pendingPlan,
    });
    const approvedPlanStrategy = resolvePlanStrategyHandoff({
      mode: engineMode === 'database' ? 'ask' : engineMode,
      pendingPlanStrategy: activeThread?.pendingPlanStrategy,
    });
    const carriedTaskList =
      engineMode === 'agent' ? activeThread?.pendingTaskList : undefined;

    const outcome = await runAskInOutputChannel({
      vs: ctx.vs,
      client,
      prompt: llmPrompt,
      workspaceRoot: ctx.effectiveRoot(),
      channel: ctx.channel,
      mode: engineMode,
      depth: message.depth,
      effort: message.effort,
      approvalMode: message.approvalMode,
      pinnedPaths: message.pinnedPaths,
      requiredSkillIds:
        message.mode === 'review'
          ? [
              'code-review-and-quality',
              ...(message.requiredSkillIds ?? []).filter(
                (id) => id !== 'code-review-and-quality',
              ),
            ].slice(0, 3)
          : message.requiredSkillIds,
      requiredMcpServerIds: message.requiredMcpServerIds,
      workspaceId: ctx.getWorkspaceId(),
      workspaceState: ctx.host.workspaceState,
      secrets: ctx.secrets,
      sessionId: ctx.session.activeThreadId,
      conversationText,
      conversation,
      approvedPlan,
      approvedPlanStrategy,
      taskList: carriedTaskList,
      handlers: createRunHandlers(ctx, cancelSource.token),
    });
    await finalizeRun(ctx, { outcome, message, prompt, llmPrompt, approvedPlan });
  } catch (error) {
    await recordRunFailure(ctx, error, message, prompt);
  } finally {
    ctx.session.activeFileChangeSnapshot = undefined;
    ctx.session.runCancel?.dispose();
    ctx.session.runCancel = undefined;
    if (ctx.session.pendingResume) {
      ctx.session.pendingResume.resolve('stop');
      ctx.session.pendingResume = undefined;
    }
    ctx.session.pendingSuspension = undefined;
  }
}
