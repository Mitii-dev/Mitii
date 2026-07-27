import type { AgentRunResult, RunEvent } from '@mitii/sdk';

/** Format run usage for TTY / OutputChannel (cost/budget view). */
export function formatUsageLine(result: AgentRunResult): string {
  const u = result.usage;
  const parts = [
    `models=${u.modelCalls}`,
    `tools=${u.toolCalls}`,
    `loops=${u.loopIterations}`,
    `inTokens=${u.inputTokens ?? 0}`,
    `outTokens=${u.outputTokens ?? 0}`,
    `durationMs=${result.durationMs}`,
  ];
  return `[mitii] usage ${parts.join(' ')}`;
}

/** Human-readable wiring / budget diagnostics from reason codes + status. */
export function formatRunDiagnostics(result: AgentRunResult): string[] {
  const lines: string[] = [];
  const codes = new Set(result.reasonCodes ?? []);

  if (result.status === 'budget_exhausted') {
    const detail =
      result.error?.message?.trim() ||
      'Run stopped because Mitii call/loop budget was exhausted (not a provider quota).';
    lines.push(`[budget] exhausted: ${detail}`);
  }

  if (codes.has('context_skipped')) {
    lines.push(
      '[context] skipped — route did not retrieve repository context (tools may also be unavailable).',
    );
  }

  if (codes.has('direct_knowledge_answer') && (result.usage?.toolCalls ?? 0) === 0) {
    lines.push(
      '[tools] none granted — direct_answer route answers from prompt context only.',
    );
  }

  if (
    codes.has('budget_exhausted') ||
    result.error?.code === 'budget_exhausted'
  ) {
    lines.push(
      '[hint] Prefer search_files/list_directory before many read_file calls, or raise run budget.',
    );
  }

  return lines;
}

/** Summarize context / prompt-related events for inspection UX. */
export function formatContextInspection(events: RunEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    if (event.type === 'context_ready') {
      const paths =
        'paths' in event && Array.isArray(event.paths) && event.paths.length
          ? ` paths=${event.paths.slice(0, 8).join(',')}`
          : '';
      lines.push(
        `[context] token=${event.stateToken.slice(0, 12)}… blocks=${event.blockCount} status=${event.status}${paths}`,
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
  kind: 'session';
  result: AgentRunResult;
  events: RunEvent[];
} {
  return {
    exportedAt: new Date().toISOString(),
    kind: 'session',
    result: options.result,
    events: options.events,
  };
}

/** Distinct audit pack: session + redacted settings + index meta. */
export function buildAuditPack(options: {
  result: AgentRunResult;
  events: RunEvent[];
  settingsRedacted: Record<string, unknown>;
  indexMeta?: Record<string, unknown>;
  workspaceRoot?: string;
}): {
  exportedAt: string;
  kind: 'audit';
  workspaceRoot?: string;
  settings: Record<string, unknown>;
  index: Record<string, unknown> | undefined;
  result: AgentRunResult;
  events: RunEvent[];
} {
  return {
    exportedAt: new Date().toISOString(),
    kind: 'audit',
    workspaceRoot: options.workspaceRoot,
    settings: options.settingsRedacted,
    index: options.indexMeta,
    result: options.result,
    events: options.events,
  };
}
