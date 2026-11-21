import type { HostAskHandlers } from '../hostAsk.js';
import { noteMutatedPaths, noteMutatedPathsFromEvent } from '../fileChanges.js';
import { planViewFromArtifact } from '../planView.js';
import { savePlanToWorkspace } from '../planStore.js';
import { saveTaskListToWorkspace } from '../taskStore.js';
import type { SidebarContext } from './context.js';
import { postReviewFindings } from './reviewFindingsSync.js';
import { waitForSuspensionResume } from './runSuspension.js';
import { savedPlanMarkdownRelative } from './runPrompt.js';

/** Live callbacks for one `runAskInOutputChannel` call (events, deltas, suspensions). */
export function createRunHandlers(
  ctx: SidebarContext,
  cancelToken: NonNullable<HostAskHandlers['cancelToken']>,
): HostAskHandlers {
  return {
    cancelToken,
    onContextBreakdown: (breakdown) => {
      ctx.tokens.applyContextBreakdown(breakdown);
      ctx.post({ type: 'tokenUsage', usage: ctx.tokens.usage });
    },
    onEvent: (event, activity) => {
      ctx.post({ type: 'run.event', event: activity });
      if (
        event?.type === 'tool_completed' &&
        event.toolName === 'emit_review_finding'
      ) {
        ctx.host.reviewFindings.ingestToolEvent({
          status: String(event.status ?? ''),
          summary:
            typeof event.summary === 'string' ? event.summary : undefined,
          outputPreview:
            typeof event.outputPreview === 'string'
              ? event.outputPreview
              : undefined,
        });
        postReviewFindings(ctx);
      }
      if (event?.type === 'plan_ready' && event.plan) {
        const livePlan = planViewFromArtifact(event.plan);
        if (livePlan) {
          ctx.post({ type: 'setPlan', plan: livePlan });
        }
      }
      if (event?.type === 'task_list_updated' && event.taskList) {
        const root = ctx.effectiveRoot();
        const isDiscoveryTask =
          event.taskList.purpose === 'discovery' ||
          event.taskList.source === 'discovery';
        if (root && !isDiscoveryTask) {
          try {
            saveTaskListToWorkspace({
              workspaceRoot: root,
              taskList: event.taskList,
              threadId: ctx.session.activeThreadId,
            });
          } catch {
            // Best-effort file mirror for debug.
          }
        }
      }
      const changeRoot = ctx.effectiveRoot();
      if (changeRoot && ctx.session.activeFileChangeSnapshot && event) {
        noteMutatedPathsFromEvent(
          ctx.session.activeFileChangeSnapshot,
          changeRoot,
          event,
        );
      }
      if (event?.type === 'model_turn') {
        ctx.tokens.recordLiveModelTurn(event);
        ctx.post({ type: 'tokenUsage', usage: ctx.tokens.usage });
      }
    },
    onDelta: (text) => {
      ctx.session.liveStreamText += text;
      ctx.post({ type: 'run.delta', text });
    },
    onSuspended: async (result, suspension) => {
      if (
        suspension.kind === 'approval_required' &&
        suspension.approval?.paths?.length &&
        ctx.session.activeFileChangeSnapshot
      ) {
        const changeRoot = ctx.effectiveRoot();
        if (changeRoot) {
          noteMutatedPaths(
            ctx.session.activeFileChangeSnapshot,
            changeRoot,
            suspension.approval.paths,
          );
        }
      }
      if (
        suspension.kind === 'approval_required' &&
        suspension.approval?.paths?.[0]
      ) {
        const root = ctx.effectiveRoot();
        const relPath = suspension.approval.paths[0];
        if (root) {
          // Best-effort: show path in inline manager with empty proposed until webview opens preview
          await ctx.host.inlineDiff.showForApproval(
            root,
            suspension.approval.approvalId,
            relPath,
            suspension.approval.toolName,
            suspension.approval.proposedText ??
              `(pending ${suspension.approval.toolName} on ${relPath})`,
          );
          ctx.host.onInlineDiffPending(true);
        }
      }
      if (suspension.kind === 'plan_approval_required') {
        const artifact = result.plan;
        const root = ctx.effectiveRoot();
        let savedPlanPath: string | undefined;
        if (root && artifact) {
          try {
            const saved = savePlanToWorkspace({
              workspaceRoot: root,
              plan: artifact,
              source: 'plan_approval',
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
        const planView =
          planViewFromArtifact(artifact, { savedPlanPath }) ??
          suspension.plan ??
          null;
        if (planView) {
          suspension.plan = planView;
          ctx.post({ type: 'setPlan', plan: planView });
        }
      }
      return waitForSuspensionResume(ctx, suspension);
    },
  };
}
