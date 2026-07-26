import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type AgentRunResult,
  type MitiiClient,
  type MitiiResumeInput,
  type RunEvent,
} from '@mitii/sdk';
import type * as vscode from 'vscode';

import {
  formatContextInspection,
  formatDiffReview,
  formatUsageLine,
} from './runReport.js';

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

async function resolveSuspension(
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
    for (const line of formatDiffReview(result)) {
      // Diff metadata shown via QuickPick description + channel by caller.
      void line;
    }
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

/**
 * Run an ask through the SDK with OutputChannel streaming + progress cancel.
 */
export async function runAskInOutputChannel(options: {
  vs: typeof vscode;
  client: MitiiClient;
  prompt: string;
  workspaceRoot?: string;
  channel: vscode.OutputChannel;
  mode?: 'ask' | 'plan' | 'agent';
}): Promise<HostAskOutcome> {
  const { vs, client, prompt, workspaceRoot, channel } = options;
  channel.show(true);
  channel.appendLine(`> ${prompt}`);

  return vs.window.withProgress(
    {
      location: vs.ProgressLocation.Notification,
      title: 'Mitii',
      cancellable: true,
    },
    async (_progress, token) => {
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
            return { result, events };
          }

          channel.appendLine('');
          for (const line of formatDiffReview(result)) {
            channel.appendLine(line);
          }
          channel.appendLine(
            `[mitii] suspended (${result.suspension?.kind ?? 'unknown'})`,
          );
          const resume = await resolveSuspension(vs, result);
          if (resume === 'stop') {
            return { result, events };
          }
          channel.appendLine('[mitii] resuming…');
          run = client.resume(resume);
        } finally {
          cancelSub.dispose();
        }
      }
    },
  );
}
