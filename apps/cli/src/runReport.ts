import type { AgentRunResult, RunEvent } from '@mitii/sdk';

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
        `[context] token=${event.stateToken.slice(0, 12)}… blocks=${event.blockCount} status=${event.status}`,
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
      lines.push(
        `[decision] route=${event.route} disposition=${event.runDisposition}`,
      );
    }
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
