import { loadProjectRules } from '@mitii/host';
import type {
  AgentMode,
  MitiiConversationMessage,
  TaskList,
} from '@mitii/sdk';

import { loadMitiiHostConfig } from '../config.js';
import { runFullWorkspaceIndex } from '../fullWorkspaceIndex.js';
import { resolveCliLoopPolicyThresholds } from '../loopPolicy.js';
import { createCliClient } from '../ports.js';
import { resolveCliSemanticIndexSettings } from '../semanticIndex.js';
import {
  createDefaultSessionIo,
  driveRun,
  type SessionIo,
} from '../session.js';
import { nextCliSessionCarry } from '../sessionCarry.js';
import { persistLatestRepositoryState } from '../stateCache.js';
import { buildWorkspaceSnapshot } from '../workspaceSnapshot.js';
import {
  clearThreadCarry,
  loadThreadCarry,
  saveThreadCarry,
} from './thread-state.js';
import type { ConnectIo } from './types.js';

export type ConnectorTurnOptions = {
  adapterName: string;
  instanceKey: string;
  threadId: string;
  prompt: string;
  cwd: string;
  mode?: AgentMode;
  forceEcho?: boolean;
  /** Default true for channel bots so mutations can complete without TTY. */
  autoApprove?: boolean;
  io: ConnectIo;
};

export type ConnectorTurnResult = {
  answer: string;
  status: string;
  exitCode: number;
};

function toSessionIo(io: ConnectIo): SessionIo {
  const base = createDefaultSessionIo();
  return {
    writeStdout: (chunk) => {
      // Collect streamed answer via driveRun result.answer; keep stderr for status.
      void chunk;
    },
    writeStderr: (chunk) => {
      const text = chunk.trimEnd();
      if (text) {
        io.writeErr(text);
      }
    },
    prompt: async () => '',
    onInterrupt: base.onInterrupt,
  };
}

async function ensurePublishedRepositoryState(options: {
  client: ReturnType<typeof createCliClient>['client'];
  workspaceId: string;
  cwd: string;
  io: ConnectIo;
}): Promise<void> {
  if (await options.client.getLatestRepositoryState(options.workspaceId)) {
    return;
  }

  const sessionIo = toSessionIo(options.io);
  try {
    const config = loadMitiiHostConfig(options.cwd);
    const full = await runFullWorkspaceIndex({
      cwd: options.cwd,
      workspaceId: options.workspaceId,
      force: true,
      semanticIndex: resolveCliSemanticIndexSettings({
        env: process.env,
        config,
      }),
    });
    const published = await options.client.publishRepositoryStateFromIndexing(
      full.indexing,
      {
        catalogRevisionByRoot: full.catalogRevisionByRoot,
        graphRevisionByRoot: full.graphRevisionByRoot,
        mapRevisionByRoot: full.mapRevisionByRoot,
      },
    );
    if (published.status === 'published') {
      persistLatestRepositoryState(options.cwd, published.descriptor);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    sessionIo.writeStderr(
      `[mitii] connector auto-index falling back to host snapshot: ${detail}\n`,
    );
    const snapshot = await buildWorkspaceSnapshot({
      workspaceRoot: options.cwd,
      workspaceId: options.workspaceId,
    });
    const published = await options.client.publishRepositoryState(
      snapshot.candidate,
    );
    if (published.status === 'published') {
      persistLatestRepositoryState(options.cwd, published.descriptor);
    }
  }
}

/**
 * Run one inbound channel message through Mitii SDK, carrying per-thread chat history.
 */
export async function runConnectorTurn(
  options: ConnectorTurnOptions,
): Promise<ConnectorTurnResult> {
  const mode = options.mode ?? 'ask';
  const carry = loadThreadCarry(
    options.adapterName,
    options.instanceKey,
    options.threadId,
    options.cwd,
  );
  const conversation: MitiiConversationMessage[] = carry?.conversation ?? [];
  const taskList: TaskList | undefined = carry?.taskList;

  const { client, ports, memoryCapture } = createCliClient({
    cwd: options.cwd,
    forceEcho: options.forceEcho === true,
  });

  await ensurePublishedRepositoryState({
    client,
    workspaceId: ports.workspaceId,
    cwd: options.cwd,
    io: options.io,
  });

  const projectRules = await loadProjectRules({
    workspaceRoot: options.cwd,
  });
  const hostConfig = loadMitiiHostConfig(options.cwd);
  const loopPolicyThresholds = resolveCliLoopPolicyThresholds({
    config: hostConfig.loopPolicy,
    disabled: false,
  });

  const autoApproval =
    options.autoApprove === false ? undefined : ('approved' as const);
  const hostApproval =
    autoApproval === 'approved'
      ? ({ approvalMode: 'never' as const, planApproval: 'never' as const })
      : {};

  const sessionIo = toSessionIo(options.io);
  const outcome = await driveRun({
    client,
    start: {
      prompt: options.prompt,
      mode,
      workspaceRoot: options.cwd,
      ...hostApproval,
      ...(projectRules.length > 0 ? { projectRules: [...projectRules] } : {}),
      ...(conversation.length > 0 ? { conversation } : {}),
      ...(mode !== 'ask' && taskList ? { taskList } : {}),
      ...(loopPolicyThresholds
        ? { loopPolicy: { thresholds: loopPolicyThresholds } }
        : {}),
    },
    json: false,
    autoApproval,
    io: sessionIo,
    memoryCapture,
  });

  const next = nextCliSessionCarry({
    mode,
    conversation,
    taskList,
    prompt: options.prompt,
    result: outcome.result,
  });
  saveThreadCarry(
    options.adapterName,
    options.instanceKey,
    options.threadId,
    {
      conversation: next.conversation,
      taskList: next.taskList,
      mode,
      updatedAt: new Date().toISOString(),
    },
    options.cwd,
  );

  const answer =
    outcome.result.answer?.trim() ||
    (outcome.result.status === 'completed'
      ? '(no text reply)'
      : `[mitii] status=${outcome.result.status}`);

  return {
    answer,
    status: outcome.result.status,
    exitCode: outcome.exitCode,
  };
}

export function resetConnectorThread(
  adapterName: string,
  instanceKey: string,
  threadId: string,
  cwd?: string,
): void {
  clearThreadCarry(adapterName, instanceKey, threadId, cwd);
}
