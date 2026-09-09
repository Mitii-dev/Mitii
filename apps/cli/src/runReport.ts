import type {
  AgentRunResult,
  RunEvent,
  TaskItemStatus,
  TaskList,
} from '@mitii/sdk';
import { taskListProgress } from '@mitii/sdk';

/** Format run usage for TTY / OutputChannel (cost/budget view). */
export function formatUsageLine(result: AgentRunResult): string {
  const u = result.usage;
  const parts = [
    `models=${u.modelCalls}`,
    `tools=${u.toolCalls}`,
    `loops=${u.loopIterations}`,
  ];
  if (typeof u.inputTokens === 'number') {
    parts.push(`inTokens=${u.inputTokens}`);
  }
  if (typeof u.outputTokens === 'number') {
    parts.push(`outTokens=${u.outputTokens}`);
  }
  parts.push(`durationMs=${result.durationMs}`);
  return `[mitii] usage ${parts.join(' ')}`;
}

/** Summarize context / prompt-related events for inspection UX. */
export function formatContextInspection(events: RunEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    if (event.type === 'context_ready') {
      lines.push(
        `[context] token=${event.stateToken.slice(0, 12)}… blocks=${event.blockCount} retrieved=${event.retrievedCandidates} selected=${event.selectedItems} dropped=${event.droppedBlocks} status=${event.status}`,
      );
      if (event.retrievalSources && event.retrievalSources.length > 0) {
        lines.push(
          `[context] sources=${event.retrievalSources
            .map(
              (source: {
                sourceId: string;
                status: string;
                candidateCount: number;
              }) =>
                `${source.sourceId}:${source.status}:${source.candidateCount}`,
            )
            .join(',')}`,
        );
      }
    } else if (event.type === 'model_turn') {
      lines.push(
        `[model] turn=${event.turnIndex} in=${event.inputTokens ?? '-'} out=${event.outputTokens ?? '-'} finish=${event.finishReason ?? '-'}${event.truncated ? ' truncated' : ''}`,
      );
    } else if (event.type === 'skills_ready') {
      lines.push(
        `[skills] selected=${event.selectedCount} omitted=${event.omittedCount} status=${event.status}`,
      );
    } else if (event.type === 'memory_ready') {
      lines.push(
        `[memory] selected=${event.selectedCount} omitted=${event.omittedCount} status=${event.status}`,
      );
    } else if (event.type === 'decision_made') {
      const tools =
        event.allowedTools && event.allowedTools.length > 0
          ? ` tools=${event.allowedTools.slice(0, 8).join(',')}${
              event.allowedTools.length > 8 ? '…' : ''
            }`
          : '';
      const prefixes =
        event.commandPrefixes && event.commandPrefixes.length > 0
          ? ` cmds=${event.commandPrefixes.slice(0, 6).join(',')}`
          : '';
      lines.push(
        `[decision] route=${event.route} disposition=${event.runDisposition} effect=${event.maximumWorkspaceEffect ?? '-'} approval=${event.approvalMode ?? '-'}${tools}${prefixes}`,
      );
      if (event.pathScopes && event.pathScopes.length > 0) {
        lines.push(`[grant] paths=${event.pathScopes.join(',')}`);
      }
    }
  }
  return lines;
}

const TASK_MARK: Record<TaskItemStatus, string> = {
  pending: '[ ]',
  active: '[>]',
  done: '[x]',
  skipped: '[-]',
  blocked: '[!]',
};

/** Render a live task list for TTY / OutputChannel. */
export function formatTaskList(taskList: TaskList): string[] {
  const progress = taskListProgress(taskList);
  const lines = [
    `[tasks] ${progress.completedCount}/${progress.totalCount} complete${
      taskList.source ? ` source=${taskList.source}` : ''
    }`,
  ];
  for (const item of taskList.items) {
    lines.push(`  ${TASK_MARK[item.status]} ${item.title}`);
  }
  return lines;
}

/** Surface approval/diff metadata from a suspended approval result. */
export function formatDiffReview(result: AgentRunResult): string[] {
  const approval = result.suspension?.approval;
  if (!approval) return [];
  const lines = [
    `[diff] tool=${approval.toolName} callId=${approval.callId} approvalId=${approval.approvalId}`,
    `[diff] fingerprint=${approval.fingerprint}`,
  ];
  if (approval.paths?.length) {
    lines.push(`[diff] paths=${approval.paths.join(', ')}`);
  }
  return lines;
}

/** Build a secret-free session export payload. */
export function buildSessionExport(options: {
  result: AgentRunResult;
  events: RunEvent[];
}): {
  exportedAt: string;
  result: AgentRunResult;
  events: RunEvent[];
} {
  return {
    exportedAt: new Date().toISOString(),
    result: options.result,
    events: options.events,
  };
}
