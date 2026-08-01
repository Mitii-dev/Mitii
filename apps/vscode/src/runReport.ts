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

  if (codes.has('prompt_blocked') || result.error?.code === 'prompt_blocked') {
    lines.push(
      '[prompt] blocked — composed context exceeded the model input budget before the first model call.',
    );
    lines.push(
      '[hint] Use a larger context window, lower max output, disable extra context toggles, or pin fewer/shorter files.',
    );
  }

  return lines;
}

export function formatVisibleFailureDetails(options: {
  result: AgentRunResult;
  events: RunEvent[];
  sessionLogPath?: string;
}): string {
  const { result, events, sessionLogPath } = options;
  if (
    result.status !== 'failed' &&
    result.status !== 'budget_exhausted' &&
    result.status !== 'cancelled'
  ) {
    return '';
  }

  const verification = [...events]
    .reverse()
    .find((event) => event.type === 'verification_completed');
  const lines: string[] = [];

  if (result.error?.message) {
    lines.push(`Reason: ${result.error.message}`);
  }
  if (
    result.reasonCodes?.includes('prompt_blocked') ||
    result.error?.code === 'prompt_blocked'
  ) {
    lines.push(
      'Hint: prompt construction overflowed the input budget before any model/tool call ran.',
    );
  }
  if (verification?.type === 'verification_completed') {
    const verificationReasons = verification.reasonCodes
      .filter((code: string) => code !== 'run_started')
      .slice(0, 4);
    lines.push(
      `Verification: ${verification.status}${
        verificationReasons.length
          ? ` (${verificationReasons.join(', ')})`
          : ''
      }`,
    );
    const failedChecks = verification.checks.filter(
      (check: { outcome: string }) =>
        check.outcome === 'failed' || check.outcome === 'timed_out',
    );
    const checksToShow = failedChecks.length
      ? failedChecks
      : verification.checks.slice(0, 3);
    for (const check of checksToShow.slice(0, 6)) {
      lines.push(`- ${check.kind}/${check.outcome}: ${check.summary}`);
    }
    const diagnosticsToShow = verification.diagnostics.filter(
      (diagnostic: { severity: string }) =>
        diagnostic.severity === 'error' || diagnostic.severity === 'warning',
    );
    for (const diagnostic of diagnosticsToShow.slice(0, 6)) {
      const line = diagnostic.startLine ? `:${diagnostic.startLine}` : '';
      lines.push(
        `- ${diagnostic.path}${line} ${diagnostic.severity}: ${diagnostic.message}`,
      );
    }
    for (const warning of verification.warnings.slice(0, 3)) {
      lines.push(`- warning: ${warning}`);
    }
  }
  if (sessionLogPath) {
    lines.push(`Session log: ${sessionLogPath}`);
  }

  return lines.length ? `\n\n**Failure Details**\n${lines.join('\n')}` : '';
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
      const selected =
        'selected' in event && Array.isArray(event.selected) && event.selected.length
          ? ` ids=${event.selected.slice(0, 8).join(',')}`
          : '';
      const omitted =
        'omitted' in event && Array.isArray(event.omitted) && event.omitted.length
          ? ` omittedIds=${event.omitted.slice(0, 8).join(',')}`
          : '';
      lines.push(
        `[skills] selected=${event.selectedCount}${selected} omitted=${event.omittedCount}${omitted} status=${event.status}`,
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
