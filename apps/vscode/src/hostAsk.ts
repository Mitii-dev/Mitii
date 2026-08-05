import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type AgentRunBudget,
  type AgentRunResult,
  type MitiiClient,
  type MitiiConversationMessage,
  type MitiiResumeInput,
  type PlanArtifact,
  type RunEvent,
} from '@mitii/sdk';
import type * as vscode from 'vscode';

import { formatDiagnosticsPromptBlock } from './context/diagnosticsContext.js';
import { captureEditorContext } from './context/editorContext.js';
import { buildContextUsageBreakdown } from './contextUsage.js';
import { readContextToggles } from './contextToggles.js';
import { getSharedMcpManager } from './mcp/manager.js';
import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';
import { estimateMemoryPromptBlock } from './memoryStore.js';
import { scaffoldMitiiWorkspace } from './mitiiWorkspace.js';
import { resolveVsCodeSemanticIndexSettings } from './semanticIndex.js';
import type {
  ActivityEventPayload,
  ContextUsageBreakdown,
  SuspensionPayload,
} from './protocol.js';
import { planViewFromArtifact } from './planView.js';
import { buildReviewDiff } from './reviewDiff.js';
import {
  formatContextInspection,
  formatDiffReview,
  formatVisibleFailureDetails,
  formatRunDiagnostics,
  formatUsageLine,
} from './runReport.js';
import { appendSessionLog } from './sessionLog.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';
import { findLocalModelPreset } from './modelPresets.js';
import { loadProjectRules } from '@mitii/host';

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
      return `[context] blocks=${event.blockCount} status=${event.status}${paths}`;
    }
    case 'decision_made':
      return `[decision] ${event.route}`;
    case 'skills_ready':
      return `[skills] selected=${event.selectedCount}${formatEventList(' ids', event.selected)} omitted=${event.omittedCount}${formatEventList(' ids', event.omitted)} status=${event.status}`;
    case 'memory_ready':
      return `[memory] selected=${event.selectedCount} omitted=${event.omittedCount} status=${event.status}`;
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

function eventAtMs(event: RunEvent): number {
  if ('at' in event && typeof event.at === 'string') {
    const parsed = Date.parse(event.at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function formatClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 23);
}

let activitySeq = 0;

const STAGE_LABELS: Record<string, string> = {
  received: 'Received request',
  understood: 'Understood intent',
  decided: 'Chose route',
  context_ready: 'Gathering context',
  skills_ready: 'Loading skills',
  memory_ready: 'Loading memory',
  plan_ready: 'Planning',
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
  const codes = event.result.reasonCodes ?? [];
  if (codes.includes('context_skipped')) {
    return 'Repository context was skipped for this route.';
  }
  return undefined;
}

export function runEventToActivity(event: RunEvent): ActivityEventPayload | undefined {
  const id = `evt_${++activitySeq}`;
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
      const detail = [event.summary, reason ? `(${reason})` : undefined]
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
      const pathPreview = paths.slice(0, 6).join(', ');
      const more =
        paths.length > 6 ? ` · +${paths.length - 6} more` : '';
      return {
        id,
        at,
        kind: 'context',
        title:
          paths.length === 1
            ? `Read @${paths[0]}`
            : paths.length > 1
              ? `Read ${paths.length} files`
              : 'Read repository context',
        detail: pathPreview
          ? `${pathPreview}${more}`
          : `${event.blockCount} block(s) · ${event.status}`,
        status: event.status,
      };
    }
    case 'decision_made':
      return {
        id,
        at,
        kind: 'decision',
        title: 'Decision',
        detail: String(event.route),
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
        detail: event.selected?.length
          ? `${event.selected.slice(0, 6).join(', ')}${
              event.selected.length > 6 ? ` · +${event.selected.length - 6} more` : ''
            }`
          : `${event.selectedCount} selected`,
      };
    case 'memory_ready':
      return {
        id,
        at,
        kind: 'info',
        title: 'Memory ready',
        detail: `${event.selectedCount} selected`,
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
    default:
      return undefined;
  }
}

type ApprovalViewSource = NonNullable<
  NonNullable<AgentRunResult['suspension']>['approval']
>;

function shellQuoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function approvalDetail(approval: ApprovalViewSource): string | undefined {
  const args = approval.arguments;
  if (
    approval.toolName === 'run_command' &&
    args &&
    typeof args === 'object' &&
    Array.isArray((args as { argv?: unknown }).argv)
  ) {
    return (args as { argv: unknown[] }).argv
      .map((arg) => shellQuoteArg(String(arg)))
      .join(' ');
  }
  return approval.paths?.join(', ');
}

export function resultToSuspension(
  result: AgentRunResult,
): SuspensionPayload | undefined {
  const suspension = result.suspension;
  if (!suspension) return undefined;
  if (suspension.kind === 'clarification_required') {
    return {
      runId: result.runId,
      kind: 'clarification_required',
      rationale: suspension.rationale,
      clarificationPrompt: suspension.clarificationPrompt,
      clarificationOptions: suspension.clarificationOptions,
    };
  }
  if (suspension.kind === 'approval_required' && suspension.approval) {
    return {
      runId: result.runId,
      kind: 'approval_required',
      rationale: suspension.rationale,
      approval: {
        approvalId: suspension.approval.approvalId,
        toolName: suspension.approval.toolName,
        paths: suspension.approval.paths,
        proposedText: suspension.approval.proposedText,
        arguments: suspension.approval.arguments,
      },
    };
  }
  if (suspension.kind === 'plan_approval_required') {
    return {
      runId: result.runId,
      kind: 'plan_approval_required',
      rationale: suspension.rationale,
      plan: planViewFromArtifact(suspension.plan ?? result.plan),
      planText: result.answer,
    };
  }
  return undefined;
}

async function resolveSuspensionNative(
  vs: typeof vscode,
  result: AgentRunResult,
): Promise<MitiiResumeInput | 'stop'> {
  const suspension = result.suspension;
  if (!suspension) return 'stop';

  if (suspension.kind === 'clarification_required') {
    const promptText = (
      suspension.clarificationPrompt ??
      suspension.rationale ??
      'Clarification required'
    ).trim();
    const safePrompt =
      promptText.includes('<<<MITII_') || promptText.length > 480
        ? 'Clarification required — reply with your choice or more detail.'
        : promptText;
    const answer = await vs.window.showInputBox({
      prompt: safePrompt,
      ignoreFocusOut: true,
      placeHolder: suspension.clarificationOptions?.[0]
        ? suspension.clarificationOptions
            .map((o: { label: string }) => o.label)
            .join(' / ')
        : undefined,
    });
    if (!answer?.trim()) return 'stop';
    return {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: result.runId,
      clarificationAnswer: answer.trim(),
    };
  }

  if (suspension.kind === 'approval_required' && suspension.approval) {
    const choice = await vs.window.showQuickPick(
      [
        {
          label: 'Approve',
          description: suspension.approval.toolName,
          detail: approvalDetail(suspension.approval),
        },
        { label: 'Deny', description: 'No mutation' },
      ],
      {
        title: 'Mitii approval required',
        placeHolder: suspension.rationale,
        ignoreFocusOut: true,
      },
    );
    if (!choice) return 'stop';
    return {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: result.runId,
      approval: {
        approvalId: suspension.approval.approvalId,
        decision: choice.label === 'Approve' ? 'approved' : 'denied',
      },
    };
  }

  if (suspension.kind === 'plan_approval_required') {
    const choice = await vs.window.showQuickPick(
      [
        { label: 'Approve plan', description: 'Continue execution' },
        { label: 'Reject plan', description: 'Cancel this run' },
      ],
      {
        title: 'Mitii plan approval required',
        placeHolder: suspension.rationale,
        ignoreFocusOut: true,
      },
    );
    if (!choice) return 'stop';
    return {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: result.runId,
      planDecision: {
        decision: choice.label === 'Approve plan' ? 'approved' : 'rejected',
      },
    };
  }

  return 'stop';
}

export interface HostAskOutcome {
  result: AgentRunResult;
  events: RunEvent[];
  /** Estimated context fill for the composed host prompt. */
  contextBreakdown?: ContextUsageBreakdown;
  /** Append-only JSONL log containing compact run + verification events. */
  sessionLogPath?: string;
}

export interface HostAskHandlers {
  onEvent?: (
    event: RunEvent | undefined,
    activity: ActivityEventPayload,
  ) => void;
  onDelta?: (text: string) => void;
  onContextBreakdown?: (breakdown: ContextUsageBreakdown) => void;
  onSuspended?: (
    result: AgentRunResult,
    suspension: SuspensionPayload,
  ) => Promise<MitiiResumeInput | 'stop'>;
  /** When set, progress notification is skipped (webview owns cancel). */
  cancelToken?: vscode.CancellationToken;
}

function composePrompt(options: {
  prompt: string;
  depth?: string;
  pinnedPaths?: string[];
  pinnedContents?: string;
  editorBlock?: string;
  diagnosticsBlock?: string;
  repoMapBlock?: string;
  gitDiffBlock?: string;
}): string {
  /** Keep in sync with v8 extractPrimaryUserMessage markers. */
  const USER_MARKER = '<<<MITII_USER_MESSAGE>>>';
  const HOST_MARKER = '<<<MITII_HOST_CONTEXT>>>';

  // Priority: pinned context first, then supplementary host evidence.
  const hostParts: string[] = [];
  if (options.depth && options.depth !== 'auto') {
    hostParts.push(`[depth:${options.depth}]`);
  }
  if (options.pinnedContents) {
    hostParts.push(options.pinnedContents);
  } else if (options.pinnedPaths?.length) {
    hostParts.push(
      `Pinned context:\n${options.pinnedPaths.map((p) => `- @${p}`).join('\n')}`,
    );
  }
  if (options.editorBlock) {
    hostParts.push(options.editorBlock);
  }
  if (options.diagnosticsBlock) {
    hostParts.push(options.diagnosticsBlock);
  }
  if (options.gitDiffBlock) {
    hostParts.push(options.gitDiffBlock);
  }
  if (options.repoMapBlock) {
    hostParts.push(options.repoMapBlock);
  }

  const parts = [`${USER_MARKER}\n${options.prompt}`];
  if (hostParts.length) {
    parts.push(`${HOST_MARKER}\n${hostParts.join('\n\n')}`);
  }
  return parts.join('\n\n');
}

function readPinnedFileContents(
  workspaceRoot: string,
  paths: string[],
  options: { maxFiles?: number; maxCharsPerFile?: number } = {},
): string {
  const maxFiles = options.maxFiles ?? 6;
  const maxCharsPerFile = options.maxCharsPerFile ?? 8_000;
  const blocks: string[] = [];
  for (const rel of paths.slice(0, maxFiles)) {
    try {
      const raw = readFileSync(join(workspaceRoot, rel), 'utf8');
      const truncated =
        raw.length > maxCharsPerFile
          ? `${raw.slice(0, maxCharsPerFile)}\n…(truncated)`
          : raw;
      blocks.push(`Pinned file @${rel}:\n\`\`\`\n${truncated}\n\`\`\``);
    } catch {
      blocks.push(`Pinned file @${rel}: (unreadable)`);
    }
  }
  if (!blocks.length) return '';
  return `Pinned file contents:\n\n${blocks.join('\n\n')}`;
}

export function resolveApprovalPolicy(preset: string | undefined): {
  approvalMode: 'never' | 'when_required' | 'every_mutation';
  planApproval: 'policy' | 'never';
} {
  switch (preset) {
    case 'safe':
      return { approvalMode: 'every_mutation', planApproval: 'policy' };
    case 'builder':
    case 'guided':
      return { approvalMode: 'never', planApproval: 'policy' };
    case 'pilot':
      return { approvalMode: 'never', planApproval: 'never' };
    default:
      return { approvalMode: 'when_required', planApproval: 'policy' };
  }
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
  pinnedPaths?: string[];
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
  handlers?: HostAskHandlers;
}): Promise<HostAskOutcome> {
  const { vs, client, workspaceRoot, channel, handlers } = options;
  const toggles = readContextToggles(vs);
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
    depth: options.depth,
    pinnedPaths,
    pinnedContents: pinnedContents || undefined,
    editorBlock: editor?.promptBlock,
    diagnosticsBlock: diagnosticsBlock || undefined,
    repoMapBlock,
    gitDiffBlock,
  });

  const cfg = vs.workspace.getConfiguration('mitii');
  const approvalPolicy = resolveApprovalPolicy(
    cfg.get<string>('safety.approvalMode') ?? 'guided',
  );
  const model = cfg.get<string>('provider.model') ?? '';
  const contextWindow =
    cfg.get<number>('provider.contextWindow') ||
    findLocalModelPreset(model)?.contextWindow ||
    32_768;
  const configuredMaximumOutputTokens = cfg.get<number>(
    'provider.maximumOutputTokens',
  );
  const maximumOutputTokens =
    typeof configuredMaximumOutputTokens === 'number' &&
    Number.isFinite(configuredMaximumOutputTokens) &&
    configuredMaximumOutputTokens > 0
      ? Math.floor(configuredMaximumOutputTokens)
      : undefined;
  const mcpCatalogTokens = getSharedMcpManager().snapshot().toolsCatalogTokens;
  const memoryBlock =
    toggles.memory && options.workspaceState && options.workspaceId
      ? await estimateMemoryPromptBlock(
          options.workspaceState,
          options.workspaceId,
        )
      : undefined;
  const contextBreakdown = buildContextUsageBreakdown({
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
      id: `evt_${++activitySeq}`,
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
        try {
          const full = await runFullWorkspaceIndex({
            mitiiDir: scaffoldMitiiWorkspace(workspaceRoot),
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
    let run = client.start({
      prompt,
      mode: options.mode ?? 'ask',
      workspaceRoot,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      approvalMode: approvalPolicy.approvalMode,
      planApproval: approvalPolicy.planApproval,
      budget: resolveRunBudget(vs),
      ...(projectRules.length > 0 ? { projectRules: [...projectRules] } : {}),
      ...(pinnedPaths.length > 0 ? { pinnedPaths } : {}),
      ...(options.conversation && options.conversation.length > 0
        ? { conversation: options.conversation }
        : {}),
      ...(options.approvedPlan ? { approvedPlan: options.approvedPlan } : {}),
    });
    const events: RunEvent[] = [];

    for (;;) {
      const cancelSub = token.onCancellationRequested(() => {
        channel.appendLine('[mitii] cancelling…');
        run.cancel('user_cancelled');
      });

      try {
        for await (const event of run.events) {
          events.push(event);
          const activity = runEventToActivity(event);
          if (activity) {
            handlers?.onEvent?.(event, activity);
          }
          if (event.type === 'model_delta') {
            if (event.kind === 'content' && event.preview) {
              handlers?.onDelta?.(event.preview);
            }
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
          handlers?.onEvent?.(undefined, {
            id: `evt_${++activitySeq}`,
            at: Date.now(),
            kind: 'info',
            title: 'Run summary',
            detail: `${usageLine.replace('[mitii] ', '')} · ${statusLine.replace('[mitii] ', '')}`,
            status: result.status,
          });
          for (const line of formatRunDiagnostics(result)) {
            handlers?.onEvent?.(undefined, {
              id: `evt_${++activitySeq}`,
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
              id: `evt_${++activitySeq}`,
              at: Date.now(),
              kind: 'warning',
              title: 'Error',
              detail: result.error.message.slice(0, 400),
              status: 'failed',
            });
          }
          const logPath = appendSessionLog(workspaceRoot, {
            kind: 'run',
            at: runStartedAt,
            prompt: options.prompt,
            mode: options.mode,
            conversationCount: options.conversation?.length ?? 0,
            result,
            events,
          }, {
            sessionId: options.sessionId,
            contextWindowTokens: contextWindow,
            maximumOutputTokens,
          });
          if (logPath) {
            channel.appendLine(`[log] ${logPath}`);
          }
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
          const logPath = appendSessionLog(workspaceRoot, {
            kind: 'run',
            at: runStartedAt,
            prompt: options.prompt,
            mode: options.mode,
            conversationCount: options.conversation?.length ?? 0,
            result,
            events,
          }, {
            sessionId: options.sessionId,
            contextWindowTokens: contextWindow,
            maximumOutputTokens,
          });
          if (logPath) {
            channel.appendLine(`[log] ${logPath}`);
          }
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
