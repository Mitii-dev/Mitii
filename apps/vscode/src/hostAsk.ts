import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type AgentRunResult,
  type MitiiClient,
  type MitiiResumeInput,
  type RunEvent,
} from '@mitii/sdk';
import type * as vscode from 'vscode';

import { loadMemories } from './chatHistory.js';
import { formatDiagnosticsPromptBlock } from './context/diagnosticsContext.js';
import { captureEditorContext } from './context/editorContext.js';
import type { ActivityEventPayload, SuspensionPayload } from './protocol.js';
import { buildReviewDiff } from './reviewDiff.js';
import {
  formatContextInspection,
  formatDiffReview,
  formatUsageLine,
} from './runReport.js';
import { appendSessionLog } from './sessionLog.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';

export function formatRunEventLine(event: RunEvent): string | undefined {
  switch (event.type) {
    case 'model_delta':
      return event.preview;
    case 'tool_started':
      return `[tool] ${event.toolName}…`;
    case 'tool_completed':
      return `[tool] ${event.toolName} → ${event.status}`;
    case 'suspended':
      return `[suspended:${event.kind}] ${event.rationale}`;
    case 'warning':
      return `[warn] ${event.message}`;
    case 'terminal':
      return `[terminal] ${event.status}`;
    case 'context_ready':
      return `[context] blocks=${event.blockCount} status=${event.status}`;
    case 'decision_made':
      return `[decision] ${event.route}`;
    case 'skills_ready':
      return `[skills] selected=${event.selectedCount} omitted=${event.omittedCount} status=${event.status}`;
    case 'memory_ready':
      return `[memory] selected=${event.selectedCount} omitted=${event.omittedCount} status=${event.status}`;
    default:
      return undefined;
  }
}

let activitySeq = 0;

export function runEventToActivity(event: RunEvent): ActivityEventPayload | undefined {
  const id = `evt_${++activitySeq}`;
  const at = Date.now();
  switch (event.type) {
    case 'stage_started':
      return {
        id,
        at,
        kind: 'info',
        title: `Starting ${event.stage}`,
        status: 'running',
      };
    case 'stage_completed':
      return {
        id,
        at,
        kind: 'info',
        title: `Finished ${event.stage}`,
        status: 'done',
      };
    case 'state_pinned':
      return {
        id,
        at,
        kind: 'context',
        title: 'Pinned repository state',
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
    case 'tool_started':
      return {
        id,
        at,
        kind: 'tool',
        title: `Running ${event.toolName}`,
        status: 'running',
      };
    case 'tool_completed':
      return {
        id,
        at,
        kind: 'tool',
        title: event.toolName,
        status: event.status,
      };
    case 'context_ready':
      return {
        id,
        at,
        kind: 'context',
        title: 'Reading repository context',
        detail: `${event.blockCount} blocks · ${event.status}`,
        status: event.status,
      };
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
        title: 'Complete',
        detail: event.status,
        status: event.status,
      };
    case 'skills_ready':
      return {
        id,
        at,
        kind: 'info',
        title: 'Skills ready',
        detail: `${event.selectedCount} selected`,
      };
    case 'memory_ready':
      return {
        id,
        at,
        kind: 'info',
        title: 'Memory ready',
        detail: `${event.selectedCount} selected`,
      };
    default:
      return undefined;
  }
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
      },
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
    const answer = await vs.window.showInputBox({
      prompt:
        suspension.clarificationPrompt ??
        suspension.rationale ??
        'Clarification required',
      ignoreFocusOut: true,
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
          detail: suspension.approval.paths?.join(', '),
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

  return 'stop';
}

export interface HostAskOutcome {
  result: AgentRunResult;
  events: RunEvent[];
}

export interface HostAskHandlers {
  onEvent?: (event: RunEvent, activity: ActivityEventPayload) => void;
  onDelta?: (text: string) => void;
  onSuspended?: (
    result: AgentRunResult,
    suspension: SuspensionPayload,
  ) => Promise<MitiiResumeInput | 'stop'>;
  /** When set, progress notification is skipped (webview owns cancel). */
  cancelToken?: vscode.CancellationToken;
}

export interface ContextToggleFlags {
  editor?: boolean;
  openTabs?: boolean;
  diagnostics?: boolean;
  repoMap?: boolean;
  gitDiff?: boolean;
  memory?: boolean;
  mcpSummary?: string;
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
  memoryBlock?: string;
  mcpSummary?: string;
}): string {
  const parts: string[] = [];
  if (options.depth && options.depth !== 'auto') {
    parts.push(`[depth:${options.depth}]`);
  }
  if (options.mcpSummary) {
    parts.push(options.mcpSummary);
  }
  if (options.memoryBlock) {
    parts.push(options.memoryBlock);
  }
  if (options.repoMapBlock) {
    parts.push(options.repoMapBlock);
  }
  if (options.gitDiffBlock) {
    parts.push(options.gitDiffBlock);
  }
  if (options.editorBlock) {
    parts.push(options.editorBlock);
  }
  if (options.diagnosticsBlock) {
    parts.push(options.diagnosticsBlock);
  }
  if (options.pinnedContents) {
    parts.push(options.pinnedContents);
  } else if (options.pinnedPaths?.length) {
    parts.push(
      `Pinned context:\n${options.pinnedPaths.map((p) => `- @${p}`).join('\n')}`,
    );
  }
  parts.push(options.prompt);
  return parts.join('\n\n');
}

function readContextToggles(vs: typeof vscode): ContextToggleFlags {
  const cfg = vs.workspace.getConfiguration('mitii.ui.contextToggles');
  return {
    editor: cfg.get<boolean>('editor') ?? true,
    openTabs: cfg.get<boolean>('openTabs') ?? false,
    diagnostics: cfg.get<boolean>('diagnostics') ?? true,
    repoMap: cfg.get<boolean>('repoMap') ?? true,
    gitDiff: cfg.get<boolean>('gitDiff') ?? true,
    memory: cfg.get<boolean>('memory') ?? true,
  };
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
  mcpSummary?: string;
  workspaceState?: vscode.Memento;
  workspaceId?: string;
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
  const pinnedPaths = [...(options.pinnedPaths ?? [])];
  if (editor?.activeRelPath && !pinnedPaths.includes(editor.activeRelPath)) {
    pinnedPaths.unshift(editor.activeRelPath);
  }

  let repoMapBlock: string | undefined;
  if (toggles.repoMap && workspaceRoot) {
    try {
      const snap = await buildWorkspaceSnapshot({
        workspaceRoot,
        workspaceId: options.workspaceId ?? 'vscode_workspace',
        maxFiles: 400,
      });
      const listed = snap.relativePaths.slice(0, 400);
      repoMapBlock = `Workspace file map (${snap.fileCount} files${
        snap.truncated ? ', truncated' : ''
      }):\n${listed.map((p) => `- ${p}`).join('\n')}`;
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

  let memoryBlock: string | undefined;
  if (toggles.memory && options.workspaceState) {
    const memories = loadMemories(options.workspaceState).slice(0, 20);
    if (memories.length) {
      memoryBlock = `Workspace memories:\n${memories
        .map((m) => `- ${m.text}`)
        .join('\n')}`;
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
    memoryBlock,
    mcpSummary: options.mcpSummary,
  });
  channel.show(true);
  channel.appendLine(`> ${options.prompt}`);
  if (editor?.activeRelPath) {
    channel.appendLine(`[context] activeEditor=@${editor.activeRelPath}`);
  }
  if (diagnosticsBlock) {
    channel.appendLine('[context] diagnostics attached');
  }
  if (repoMapBlock) {
    channel.appendLine('[context] repo map attached');
  }
  if (gitDiffBlock) {
    channel.appendLine('[context] git diff attached');
  }
  if (pinnedContents) {
    channel.appendLine(
      `[context] pinned file contents (${pinnedPaths.length})`,
    );
  }

  // Ensure repository state exists so context/tool routes can pin.
  if (workspaceRoot) {
    try {
      const latest = await client.getLatestRepositoryState(
        options.workspaceId ?? 'vscode_workspace',
      );
      if (!latest) {
        const snap = await buildWorkspaceSnapshot({
          workspaceRoot,
          workspaceId: options.workspaceId ?? 'vscode_workspace',
        });
        await client.publishRepositoryState(snap.candidate);
        channel.appendLine(
          `[index] auto-published host snapshot (${snap.fileCount} files)`,
        );
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
    let run = client.start({
      prompt,
      mode: options.mode ?? 'ask',
      workspaceRoot,
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
            if (event.type === 'model_delta') {
              channel.append(line);
            } else {
              channel.appendLine(line);
            }
          }
        }
        const result = await run.result;
        if (result.status !== 'suspended') {
          channel.appendLine('');
          for (const line of formatContextInspection(events)) {
            channel.appendLine(line);
          }
          for (const line of formatDiffReview(result)) {
            channel.appendLine(line);
          }
          channel.appendLine(formatUsageLine(result));
          channel.appendLine(
            `[mitii] status=${result.status} route=${result.route ?? 'n/a'}`,
          );
          const logPath = appendSessionLog(workspaceRoot, {
            kind: 'run',
            at: new Date().toISOString(),
            prompt: options.prompt,
            mode: options.mode,
            result,
            events,
          });
          if (logPath) {
            channel.appendLine(`[log] ${logPath}`);
          }
          return { result, events };
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
            at: new Date().toISOString(),
            prompt: options.prompt,
            mode: options.mode,
            result,
            events,
          });
          if (logPath) {
            channel.appendLine(`[log] ${logPath}`);
          }
          return { result, events };
        }
        channel.appendLine('[mitii] resuming…');
        run = client.resume(resume);
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
