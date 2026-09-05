import type {
  PlanArtifact,
  RunEvent,
} from '@mitii/sdk';

import type {
  ActivityEventPayload,
} from './protocol.js';

export function formatRunEventLine(event: RunEvent): string | undefined {
  switch (event.type) {
    case 'model_delta':
      // Stream content only; reasoning is summarized in the activity panel.
      if (event.kind !== 'content') return undefined;
      return event.preview;
    case 'model_turn': {
      const inTok = event.inputTokens ?? 0;
      const outTok = event.outputTokens ?? 0;
      const trunc = event.truncated ? ' truncated' : '';
      return `[tokens] turn=${event.turnIndex} ↑${inTok} ↓${outTok}${trunc}${
        event.finishReason ? ` finish=${event.finishReason}` : ''
      }`;
    }
    case 'tool_started':
      return `[tool] ${event.toolName}${event.summary ? ` ${event.summary}` : ''}…`;
    case 'tool_completed':
      return `[tool] ${event.toolName}${event.summary ? ` ${event.summary}` : ''} → ${event.status}`;
    case 'suspended':
      return `[suspended:${event.kind}] ${event.rationale}`;
    case 'warning':
      return `[warn] ${event.message}`;
    case 'terminal': {
      const err = event.result.error?.message?.trim();
      return err
        ? `[terminal] ${event.status}: ${err.slice(0, 240)}`
        : `[terminal] ${event.status}`;
    }
    case 'context_ready': {
      const paths =
        'paths' in event && Array.isArray(event.paths) && event.paths.length
          ? ` paths=${event.paths.slice(0, 6).join(',')}`
          : '';
      return `[context] blocks=${event.blockCount} retrieved=${event.retrievedCandidates} selected=${event.selectedItems} dropped=${event.droppedBlocks} status=${event.status}${paths}`;
    }
    case 'decision_made':
      return `[decision] ${event.route}${event.maximumWorkspaceEffect ? ` effect=${event.maximumWorkspaceEffect}` : ''}${event.approvalMode ? ` approval=${event.approvalMode}` : ''}${formatEventList(' tools', event.allowedTools)}${formatEventList(' cmds', event.commandPrefixes)}${formatEventList(' scopes', event.pathScopes)}`;
    case 'grant_narrowed':
      return `[grant] narrowed effect=${event.maximumWorkspaceEffect} approval=${event.approvalMode}${formatEventList(' scopes', event.pathScopes)}`;
    case 'skills_ready':
      return `[skills] selected=${event.selectedCount}${event.requiredCount ? ` required=${event.requiredCount}` : ''}${formatEventList(' ids', event.selected)}${formatEventList(' required', event.required)} omitted=${event.omittedCount}${formatSkillOmissions(event)} status=${event.status}`;
    case 'memory_ready':
      return `[memory] selected=${event.selectedCount} omitted=${event.omittedCount} status=${event.status}`;
    case 'prompt_ready': {
      const used = event.budget?.totalUsedTokens;
      const reserved = event.budget?.outputReservedTokens;
      const usable = event.window?.usableInputTokens;
      const parts = [
        `status=${event.status}`,
        typeof used === 'number' ? `used=${used}` : undefined,
        typeof reserved === 'number' ? `output=${reserved}` : undefined,
        typeof usable === 'number' ? `usable=${usable}` : undefined,
        event.totalOmittedTokens > 0
          ? `omitted=${event.totalOmittedTokens}`
          : undefined,
        event.totalTruncatedTokens > 0
          ? `truncated=${event.totalTruncatedTokens}`
          : undefined,
      ].filter(Boolean);
      return `[prompt] ${parts.join(' ')}`;
    }
    case 'task_list_updated':
      return `[tasks] ${event.completedCount}/${event.totalCount} complete`;
    case 'evidence_updated':
      return `[evidence] issues=${event.evidence.issues.length} ledger=${event.evidence.ledger.length}${event.evidence.finalStopReason ? ` stop=${event.evidence.finalStopReason}` : ''}`;
    case 'repo_build_state_captured':
      return `[verify] ${event.phase} errors=${event.errorCount} warnings=${event.warningCount}`;
    case 'verification_comparison':
      return `[verify] delta new=${event.newErrorCount} remaining=${event.remainingErrorCount} cleared=${event.clearedErrorCount}`;
    case 'verification_record_saved':
      return `[verify] record ${event.recordId} status=${event.status}${event.retryAvailable ? ' retry=yes' : ''}`;
    case 'verification_summary_ready':
      return `[verify] summary chars=${event.summaryChars}`;
    case 'verification_retry_available':
      return `[verify] retry available record=${event.recordId}`;
    case 'discovery_started':
      return `[discovery] started`;
    case 'discovery_progress':
      return `[discovery] files=${event.filesRead} searches=${event.searches}`;
    case 'discovery_completed':
      return `[discovery] ${event.confidence} files=${event.fileCount} surfaces=${event.surfaceCount}`;
    case 'stage_started':
      return `[stage] ${event.stage}…`;
    case 'stage_completed':
      return `[stage] ${event.stage} done`;
    default:
      return undefined;
  }
}

function formatEventList(label: string, values: readonly string[] | undefined): string {
  if (!values?.length) return '';
  const preview = values.slice(0, 6).join(',');
  const more = values.length > 6 ? `,+${values.length - 6}` : '';
  return `${label}=${preview}${more}`;
}

export function eventAtMs(event: RunEvent): number {
  if ('at' in event && typeof event.at === 'string') {
    const parsed = Date.parse(event.at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export function formatClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 23);
}

let activitySeq = 0;

export function nextActivityEventId(): string {
  return `evt_${++activitySeq}`;
}

type SkillOmittedDetail = {
  id: string;
  reason: string;
  tokens?: number;
};

const STAGE_LABELS: Record<string, string> = {
  received: 'Received request',
  understood: 'Understood intent',
  decided: 'Chose route',
  context_ready: 'Gathering context',
  skills_ready: 'Loading skills',
  memory_ready: 'Loading memory',
  plan_ready: 'Planning',
  discovery: 'Investigating request',
  model_running: 'Running model',
  tool_running: 'Running tools',
  verifying: 'Verifying changes',
  answering: 'Answering',
  planning: 'Planning',
  acting: 'Acting',
};

function terminalTitle(status: string): string {
  switch (status) {
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'suspended':
      return 'Paused';
    case 'budget_exhausted':
      return 'Budget exhausted';
    default:
      return 'Finished';
  }
}

function terminalDetail(event: Extract<RunEvent, { type: 'terminal' }>): string | undefined {
  if (event.status === 'budget_exhausted') {
    const msg =
      event.result.error?.message?.trim() ||
      'Mitii run budget exhausted (tool/model/loop limits), not a provider quota.';
    return msg.slice(0, 240);
  }
  const err = event.result.error?.message?.trim();
  if (err) return err.slice(0, 240);
  // Keep "Done" clean — context/tool wiring notes belong on Run diagnostic,
  // with Run summary as the final activity row.
  return undefined;
}

export function runEventToActivity(event: RunEvent): ActivityEventPayload | undefined {
  const id = nextActivityEventId();
  const at = eventAtMs(event);
  switch (event.type) {
    case 'stage_started':
      return {
        id,
        at,
        kind: 'info',
        title: STAGE_LABELS[event.stage] ?? event.stage,
        status: 'running',
      };
    case 'stage_completed':
      return {
        id,
        at,
        kind: 'info',
        title: STAGE_LABELS[event.stage] ?? event.stage,
        status: 'done',
      };
    case 'state_pinned':
      return {
        id,
        at,
        kind: 'context',
        title: 'Repository state pinned',
        detail: event.state.stateToken.slice(0, 16),
      };
    case 'model_delta':
      if (event.kind === 'reasoning') {
        return {
          id,
          at,
          kind: 'thinking',
          title: 'Thinking',
          detail: event.preview,
        };
      }
      if (event.kind === 'tool_call') {
        return {
          id,
          at,
          kind: 'tool',
          title: 'Preparing tool',
          detail: event.preview,
        };
      }
      return {
        id,
        at,
        kind: 'delta',
        title: 'Writing',
        detail: event.preview,
      };
    case 'model_turn': {
      const inTok = event.inputTokens ?? 0;
      const outTok = event.outputTokens ?? 0;
      return {
        id,
        at,
        kind: event.truncated ? 'warning' : 'info',
        title: event.truncated
          ? `Tokens · turn ${event.turnIndex + 1} truncated`
          : `Tokens · turn ${event.turnIndex + 1}`,
        detail: `↑${inTok.toLocaleString()} sent · ↓${outTok.toLocaleString()} received${
          event.finishReason ? ` · ${event.finishReason}` : ''
        }`,
        status: event.truncated ? 'failed' : 'done',
      };
    }
    case 'tool_started':
      return {
        id,
        at,
        kind: 'tool',
        title: `Running ${event.toolName}`,
        detail: event.summary,
        status: 'running',
      };
    case 'tool_completed': {
      const reason =
        'reasonCode' in event && typeof event.reasonCode === 'string'
          ? event.reasonCode
          : undefined;
      const warning =
        Array.isArray(event.warnings) &&
        typeof event.warnings[0] === 'string'
          ? event.warnings[0]
          : undefined;
      const detail = [
        event.summary,
        reason ? `(${reason})` : undefined,
        warning,
      ]
        .filter(Boolean)
        .join(' ');
      return {
        id,
        at,
        kind: 'tool',
        title: event.toolName,
        detail: detail || undefined,
        status: event.status,
      };
    }
    case 'context_ready': {
      const rawPaths =
        'paths' in event && Array.isArray(event.paths) ? event.paths : [];
      const paths = rawPaths.filter(
        (path: unknown): path is string =>
          typeof path === 'string' && path.trim().length > 0,
      );
      const previewPaths = paths.slice(0, 6);
      const moreCount = Math.max(0, paths.length - previewPaths.length);
      const pathDetail = previewPaths.length
        ? [
            ...previewPaths,
            moreCount > 0 ? `+${moreCount} more` : undefined,
          ]
            .filter(Boolean)
            .join('\n')
        : undefined;
      return {
        id,
        at,
        kind: 'context',
        title:
          paths.length === 1
            ? 'Read file'
            : paths.length > 1
              ? `Read ${paths.length} files`
              : 'Read repository context',
        detail: pathDetail
          ? pathDetail
          : `${event.blockCount} block(s) · retrieved ${event.retrievedCandidates} · selected ${event.selectedItems} · dropped ${event.droppedBlocks} · ${event.status}`,
        status: event.status,
      };
    }
    case 'prompt_ready': {
      const used = event.budget?.totalUsedTokens;
      const output = event.budget?.outputReservedTokens;
      const usable = event.window?.usableInputTokens;
      return {
        id,
        at,
        kind: 'context',
        title: 'Prompt budget ready',
        detail: [
          event.status,
          typeof used === 'number' ? `${used.toLocaleString()} used` : undefined,
          typeof output === 'number'
            ? `${output.toLocaleString()} output reserved`
            : undefined,
          typeof usable === 'number'
            ? `${usable.toLocaleString()} usable`
            : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
        status:
          event.status === 'blocked' ? 'failed' : 'done',
      };
    }
    case 'decision_made':
      return {
        id,
        at,
        kind: 'decision',
        title: 'Decision',
        detail: [
          String(event.route),
          event.maximumWorkspaceEffect
            ? `effect ${event.maximumWorkspaceEffect}`
            : undefined,
          event.approvalMode ? `approval ${event.approvalMode}` : undefined,
          event.allowedTools?.length
            ? `tools ${event.allowedTools.slice(0, 6).join(', ')}`
            : undefined,
          event.pathScopes?.length
            ? `scope ${event.pathScopes.slice(0, 4).join(', ')}`
            : undefined,
        ].filter(Boolean).join(' · '),
      };
    case 'grant_narrowed':
      return {
        id,
        at,
        kind: 'decision',
        title: 'Grant narrowed',
        detail: [
          `effect ${event.maximumWorkspaceEffect}`,
          `approval ${event.approvalMode}`,
          event.pathScopes.length
            ? `scope ${event.pathScopes.slice(0, 4).join(', ')}`
            : undefined,
        ].filter(Boolean).join(' · '),
      };
    case 'warning':
      return {
        id,
        at,
        kind: 'warning',
        title: 'Warning',
        detail: event.message,
      };
    case 'suspended':
      return {
        id,
        at,
        kind: 'suspended',
        title: `Paused · ${event.kind}`,
        detail: event.rationale,
      };
    case 'terminal':
      return {
        id,
        at,
        kind: 'terminal',
        title: terminalTitle(event.status),
        detail: terminalDetail(event),
        status: event.status,
      };
    case 'skills_ready':
      return {
        id,
        at,
        kind: 'info',
        title: 'Skills ready',
        detail: formatSkillsReadyDetail(event),
      };
    case 'memory_ready':
      return {
        id,
        at,
        kind: 'info',
        title: 'Memory ready',
        detail: `${event.selectedCount} selected`,
      };
    case 'discovery_started':
      return {
        id,
        at,
        kind: 'info',
        title: 'Investigating request',
        detail: event.objective,
      };
    case 'discovery_progress':
      return {
        id,
        at,
        kind: 'info',
        title: 'Discovery progress',
        detail: `${event.filesRead} files · ${event.searches} searches`,
      };
    case 'discovery_completed':
      return {
        id,
        at,
        kind: 'info',
        title: 'Discovery complete',
        detail: `${event.confidence} confidence · ${event.surfaceCount} surfaces`,
      };
    case 'plan_ready':
      return {
        id,
        at,
        kind: 'info',
        title: 'Plan ready',
        detail: [
          `${event.phaseCount} phase${event.phaseCount === 1 ? '' : 's'}`,
          event.plan
            ? `${event.plan.phases.reduce(
                (sum: number, phase: PlanArtifact['phases'][number]) =>
                  sum + phase.steps.length,
                0,
              )} steps`
            : undefined,
          event.planningDepth,
          event.approvalRequired ? 'approval required' : undefined,
        ].filter(Boolean).join(' · '),
      };
    case 'task_list_updated':
      return {
        id,
        at,
        kind: 'info',
        title: 'Tasks updated',
        detail: `${event.completedCount}/${event.totalCount} complete`,
      };
    case 'evidence_updated':
      return {
        id,
        at,
        kind: 'info',
        title: 'Evidence updated',
        detail: [
          `${event.evidence.issues.length} issue${event.evidence.issues.length === 1 ? '' : 's'}`,
          `${event.evidence.ledger.length} ledger entr${event.evidence.ledger.length === 1 ? 'y' : 'ies'}`,
          event.evidence.finalStopReason,
        ].filter(Boolean).join(' · '),
      };
    case 'repo_build_state_captured':
      return {
        id,
        at,
        kind: 'info',
        title: `Build state ${event.phase}`,
        detail: `${event.errorCount} error(s) · ${event.warningCount} warning(s)`,
      };
    case 'verification_comparison':
      return {
        id,
        at,
        kind: event.newErrorCount > 0 ? 'warning' : 'info',
        title: 'Verification comparison',
        detail: `new ${event.newErrorCount} · remaining ${event.remainingErrorCount} · cleared ${event.clearedErrorCount}`,
      };
    case 'verification_record_saved':
      return {
        id,
        at,
        kind: 'info',
        title: 'Verification record saved',
        detail: `${event.status}${event.retryAvailable ? ' · retry available' : ''}`,
      };
    case 'verification_summary_ready':
      return {
        id,
        at,
        kind: 'info',
        title: 'Verification summary',
        detail: `${event.summaryChars} chars`,
      };
    case 'verification_retry_available':
      return {
        id,
        at,
        kind: 'info',
        title: 'Verification retry available',
        detail: event.recordId,
      };
    default:
      return undefined;
  }
}

function formatSkillOmissions(
  event: Extract<RunEvent, { type: 'skills_ready' }>,
): string {
  if (event.omittedDetails?.length) {
    const preview = event.omittedDetails
      .slice(0, 6)
      .map((item: SkillOmittedDetail) =>
        item.tokens === undefined
          ? `${item.id}:${item.reason}`
          : `${item.id}:${item.reason}(${item.tokens})`,
      )
      .join(',');
    const more =
      event.omittedDetails.length > 6
        ? `,+${event.omittedDetails.length - 6}`
        : '';
    return ` ids=${preview}${more}`;
  }
  return formatEventList(' ids', event.omitted);
}

function formatSkillsReadyDetail(
  event: Extract<RunEvent, { type: 'skills_ready' }>,
): string {
  const selected = event.selected?.length
    ? `${event.selected.slice(0, 6).join(', ')}${
        event.selected.length > 6 ? ` · +${event.selected.length - 6} more` : ''
      }`
    : `${event.selectedCount} selected`;
  if (!event.omittedDetails?.length) {
    return selected;
  }
  const omitted = event.omittedDetails
    .slice(0, 3)
    .map((item: SkillOmittedDetail) => `${item.id}:${item.reason}`)
    .join(', ');
  const more =
    event.omittedDetails.length > 3
      ? ` · +${event.omittedDetails.length - 3} omitted`
      : '';
  return `${selected} · omitted ${omitted}${more}`;
}
