import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type AgentRunResult,
  type MitiiResumeInput,
  type RunEvent,
} from '@mitii/sdk';
import type * as vscode from 'vscode';

import type {
  ActivityEventPayload,
  ContextUsageBreakdown,
  SuspensionPayload,
} from './protocol.js';
import { planViewFromArtifact } from './planView.js';

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
  if (suspension.kind === 'grant_expansion_required' && suspension.grantExpansion) {
    return {
      runId: result.runId,
      kind: 'grant_expansion_required',
      rationale: suspension.rationale,
      grantExpansion: suspension.grantExpansion,
    };
  }
  if (suspension.kind === 'continue_required') {
    return {
      runId: result.runId,
      kind: 'continue_required',
      rationale: suspension.rationale,
      continuePrompt: suspension.continuePrompt ?? suspension.rationale,
    };
  }
  return undefined;
}

export async function resolveSuspensionNative(
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

  if (suspension.kind === 'grant_expansion_required' && suspension.grantExpansion) {
    const pathPreview = suspension.grantExpansion.extraPaths.slice(0, 5).join(', ');
    const choice = await vs.window.showQuickPick(
      [
        {
          label: 'Expand access',
          description: pathPreview || 'Additional workspace paths',
        },
        { label: 'Deny expansion', description: 'Keep current grant' },
      ],
      {
        title: 'Mitii workspace access expansion',
        placeHolder: suspension.rationale,
        ignoreFocusOut: true,
      },
    );
    if (!choice) return 'stop';
    return {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: result.runId,
      grantExpansion: {
        expansionId: suspension.grantExpansion.expansionId,
        decision: choice.label === 'Expand access' ? 'approved' : 'denied',
      },
    };
  }

  if (suspension.kind === 'continue_required') {
    const choice = await vs.window.showQuickPick(
      [
        { label: 'Continue', description: 'Keep working on remaining tasks' },
        { label: 'Stop here', description: 'Finish with partial progress' },
      ],
      {
        title: 'Mitii continue required',
        placeHolder:
          suspension.continuePrompt ?? suspension.rationale ?? 'Continue this run?',
        ignoreFocusOut: true,
      },
    );
    if (!choice) return 'stop';
    return {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: result.runId,
      continueDecision: {
        decision: choice.label === 'Continue' ? 'continue' : 'stop',
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

export function composePrompt(options: {
  prompt: string;
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
  // Depth is a structured `explorationDepth` field on the start input, not a
  // prompt tag — Engine strategy rules read it directly.
  const hostParts: string[] = [];
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

export function readPinnedFileContents(
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
    return (args as { argv: unknown[] })
      .argv.map((arg) => shellQuoteArg(String(arg)))
      .join(' ');
  }
  return approval.paths?.join(', ');
}
