import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type AgentRunResult,
  type MitiiClient,
  type MitiiResumeInput,
  type MitiiStartInput,
  type MitiiRun,
  type RunEvent,
} from '@mitii/sdk';
import * as readline from 'node:readline';

import { formatTaskList } from './runReport.js';

export interface SessionIo {
  writeStdout: (chunk: string) => void;
  writeStderr: (chunk: string) => void;
  /**
   * Prompt the user on a TTY. Tests may inject a stub.
   * Return empty string to treat as cancel/deny.
   */
  prompt: (question: string) => Promise<string>;
  /**
   * Register a SIGINT (or equivalent) handler; return unsubscribe.
   * Default wires `process.on('SIGINT')`.
   */
  onInterrupt?: (handler: () => void) => () => void;
}

export interface DriveRunOptions {
  client: MitiiClient;
  start: MitiiStartInput;
  json?: boolean;
  /** Non-interactive clarification answer. */
  autoClarify?: string;
  /** Non-interactive approval decision. */
  autoApproval?: 'approved' | 'denied';
  io: SessionIo;
}

export interface DriveRunOutcome {
  exitCode: number;
  result: AgentRunResult;
  events: RunEvent[];
}

export function createDefaultSessionIo(): SessionIo {
  return {
    writeStdout: (chunk) => {
      process.stdout.write(chunk);
    },
    writeStderr: (chunk) => {
      process.stderr.write(chunk);
    },
    prompt: promptLine,
    onInterrupt: (handler) => {
      const wrapped = () => handler();
      process.on('SIGINT', wrapped);
      return () => {
        process.off('SIGINT', wrapped);
      };
    },
  };
}

function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Build SDK resume input from a suspended run result.
 * Returns null when the suspension cannot be resumed from host UX.
 */
export function buildResumeInput(
  result: AgentRunResult,
  decision:
    | { kind: 'clarification'; answer: string }
    | { kind: 'approval'; decision: 'approved' | 'denied' },
): MitiiResumeInput | null {
  if (result.status !== 'suspended' || !result.suspension) {
    return null;
  }

  if (
    decision.kind === 'clarification' &&
    result.suspension.kind === 'clarification_required'
  ) {
    const answer = decision.answer.trim();
    if (!answer) return null;
    return {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: result.runId,
      clarificationAnswer: answer,
    };
  }

  if (
    decision.kind === 'approval' &&
    result.suspension.kind === 'approval_required' &&
    result.suspension.approval
  ) {
    return {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: result.runId,
      approval: {
        approvalId: result.suspension.approval.approvalId,
        decision: decision.decision,
      },
    };
  }

  return null;
}

function streamEvents(
  run: MitiiRun,
  io: SessionIo,
  json: boolean,
  events: RunEvent[],
): Promise<void> {
  return (async () => {
    for await (const event of run.events) {
      events.push(event);
      if (json) continue;
      if (
        event.type === 'model_delta' &&
        typeof event.preview === 'string' &&
        event.preview.length > 0
      ) {
        io.writeStdout(event.preview);
      } else if (event.type === 'tool_started') {
        io.writeStderr(`[mitii] tool ${event.toolName}…\n`);
      } else if (event.type === 'task_list_updated') {
        for (const line of formatTaskList(event.taskList)) {
          io.writeStderr(`${line}\n`);
        }
      } else if (event.type === 'suspended') {
        io.writeStderr(
          `[mitii] suspended (${event.kind}): ${event.rationale}\n`,
        );
      }
    }
  })();
}

async function resolveSuspension(
  result: AgentRunResult,
  options: DriveRunOptions,
): Promise<MitiiResumeInput | 'stop' | 'cancel'> {
  const suspension = result.suspension;
  if (!suspension) return 'stop';

  if (suspension.kind === 'clarification_required') {
    const promptText =
      suspension.clarificationPrompt ??
      suspension.rationale ??
      'Clarification required';
    const answer =
      options.autoClarify ??
      (await options.io.prompt(`${promptText}\n> `));
    if (!answer.trim()) {
      options.io.writeStderr('[mitii] clarification cancelled\n');
      return 'cancel';
    }
    const resume = buildResumeInput(result, {
      kind: 'clarification',
      answer,
    });
    return resume ?? 'stop';
  }

  if (suspension.kind === 'approval_required') {
    const detail = suspension.approval
      ? `${suspension.approval.toolName} (${suspension.approval.callId})`
      : suspension.rationale;
    const decision =
      options.autoApproval ??
      (await (async () => {
        const raw = await options.io.prompt(
          `Approve ${detail}? [y/N] `,
        );
        const normalized = raw.trim().toLowerCase();
        if (normalized === 'y' || normalized === 'yes') return 'approved';
        return 'denied';
      })());
    const resume = buildResumeInput(result, {
      kind: 'approval',
      decision,
    });
    return resume ?? 'stop';
  }

  return 'stop';
}

function exitCodeFor(
  result: AgentRunResult,
  options: { declinedSuspension?: boolean },
): number {
  if (options.declinedSuspension) {
    return 1;
  }
  if (result.status === 'completed') {
    return 0;
  }
  if (result.status === 'suspended') {
    // JSON non-interactive suspend is a successful checkpoint for scripting.
    return 0;
  }
  if (result.status === 'cancelled') {
    return 130;
  }
  return 1;
}

/**
 * Drive a start → (optional resume)* loop with streaming and cancel.
 */
export async function driveRun(
  options: DriveRunOptions,
): Promise<DriveRunOutcome> {
  const json = options.json === true;
  const events: RunEvent[] = [];
  let run = options.client.start(options.start);
  let result: AgentRunResult;
  let declinedSuspension = false;

  for (;;) {
    const unsubscribe = options.io.onInterrupt
      ? options.io.onInterrupt(() => {
          options.io.writeStderr('\n[mitii] cancelling…\n');
          run.cancel('user_interrupted');
        })
      : () => undefined;

    try {
      await streamEvents(run, options.io, json, events);
      result = await run.result;
    } finally {
      unsubscribe();
    }

    if (result.status !== 'suspended') {
      break;
    }

    if (json && !options.autoClarify && !options.autoApproval) {
      // Non-interactive JSON: emit suspended result and stop (caller may resume later).
      break;
    }

    const next = await resolveSuspension(result, options);
    if (next === 'cancel' || next === 'stop') {
      declinedSuspension = next === 'cancel';
      break;
    }

    if (!json) {
      options.io.writeStderr('[mitii] resuming…\n');
    }
    run = options.client.resume(next);
  }

  if (json) {
    options.io.writeStdout(
      `${JSON.stringify({ result, events }, null, 2)}\n`,
    );
  } else {
    if (result.answer && !events.some((e) => e.type === 'model_delta')) {
      options.io.writeStdout(`${result.answer}\n`);
    } else if (result.answer) {
      options.io.writeStdout('\n');
    }
    options.io.writeStderr(
      `[mitii] status=${result.status} route=${result.route ?? 'n/a'}\n`,
    );
  }

  return {
    exitCode: exitCodeFor(result, { declinedSuspension }),
    result,
    events,
  };
}
