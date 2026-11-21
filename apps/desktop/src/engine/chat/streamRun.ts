/** NDJSON run streaming for /v1/prompt and /v1/resume. */

import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  isModelIoLoggingEnabled,
  openModelIoLog,
  openSessionLog,
  setActiveModelIoSink,
} from '@mitii/host';
import {
  type MitiiClient,
} from '@mitii/sdk';
import {
  getSharedMcpManager,
} from '@mitii/mcp';
import {
  persistExcalidrawFromToolResult,
} from '../excalidrawArtifacts.js';
import {
  type DesktopMcpAppEvent,
} from '../../shared/protocol.js';
import {
  appendRunLog,
  resolveLogsDir,
} from '../../shared/project-logs.js';
import {
  readDesktopSettingsJson,
} from '../startOptions.js';
import {
  recordCheckpointLabel,
} from '../checkpointLabels.js';
import {
  writeNdjson,
} from '../http/httpUtils.js';

export async function streamRun(
  id: string,
  mode: 'ask' | 'plan' | 'agent',
  startOrResume: () => ReturnType<MitiiClient['start']>,
  res: ServerResponse,
  meta?: {
    model?: string;
    baseUrl?: string;
    workspaceRoot?: string;
    prompt?: string;
    sessionId?: string;
    conversationCount?: number;
  },
  req?: IncomingMessage,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'transfer-encoding': 'chunked',
  });
  writeNdjson(res, { op: 'ready', id, mode });
  const logsDir = resolveLogsDir();
  appendRunLog(logsDir, `run_start id=${id} mode=${mode}`, {
    model: meta?.model ?? process.env.MITII_MODEL ?? '',
    baseUrl: meta?.baseUrl ?? process.env.MITII_BASE_URL ?? '',
  });

  const mcpManager = getSharedMcpManager({ clientInfoName: 'mitii-desktop' });
  const workspaceRoot = meta?.workspaceRoot;
  mcpManager.setToolResultListener(async (event) => {
    if (!workspaceRoot) return;
    if (event.toolName !== 'create_view' || event.result.isError) return;

    const persisted = persistExcalidrawFromToolResult({
      workspaceRoot,
      event,
      threadId: meta?.sessionId ?? id,
    });
    if (!persisted) {
      appendRunLog(
        logsDir,
        '[mcp-app] create_view succeeded but no elements were available to persist',
      );
      return;
    }

    let html: string | undefined;
    if (event.resourceUri) {
      try {
        const resource = await mcpManager.readResource(
          event.serverId,
          event.resourceUri,
        );
        const first = resource.contents[0];
        if (first?.text) {
          html = first.text;
        } else if (first?.blob) {
          html = Buffer.from(first.blob, 'base64').toString('utf8');
        }
      } catch (error) {
        appendRunLog(
          logsDir,
          `[mcp-app] resources/read failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(
      persisted.svg,
      'utf8',
    ).toString('base64')}`;

    appendRunLog(
      logsDir,
      `[mcp-app] saved diagram → ${persisted.paths.relativeMd}`,
    );

    const mcpAppEvent: DesktopMcpAppEvent = {
      type: 'mcp_app',
      at: new Date().toISOString(),
      detail: `Saved ${persisted.paths.relativeMd}`,
      mcpApp: {
        serverId: event.serverId,
        tool: event.toolName,
        title: persisted.title,
        ...(persisted.paths.checkpointId
          ? { checkpointId: persisted.paths.checkpointId }
          : {}),
        svgDataUrl,
        ...(html ? { html } : {}),
        paths: {
          md: persisted.paths.relativeMd,
          ...(persisted.paths.relativeDocsMd
            ? { docsMd: persisted.paths.relativeDocsMd }
            : {}),
          excalidraw: persisted.paths.relativeExcalidraw,
          svg: persisted.paths.relativeSvg,
        },
      },
    };
    writeNdjson(res, { op: 'event', id, event: mcpAppEvent });
  });

  let sessionLog: ReturnType<typeof openSessionLog>;
  let modelIoLog: ReturnType<typeof openModelIoLog>;
  try {
    const run = startOrResume();
    const onClientGone = () => {
      if (res.writableEnded) return;
      appendRunLog(logsDir, `run_cancel id=${id} reason=user_cancelled`);
      try {
        run.cancel('user_cancelled');
      } catch {
        /* ignore */
      }
    };
    req?.once('close', onClientGone);
    res.once('close', onClientGone);

    const runStartedAt = new Date().toISOString();
    sessionLog = openSessionLog(meta?.workspaceRoot, {
      at: runStartedAt,
      prompt: meta?.prompt ?? '',
      mode,
      sessionId: meta?.sessionId ?? id,
      runId: run.runId ?? id,
      conversationCount: meta?.conversationCount ?? 0,
    });
    if (sessionLog?.path) {
      appendRunLog(logsDir, `session_log ${sessionLog.path}`);
    }

    const settings = readDesktopSettingsJson(process.env);
    const developer = settings?.developer as Record<string, unknown> | undefined;
    const modelIoOn = isModelIoLoggingEnabled(
      developer?.enabled === true,
      developer?.modelIo === true,
    );
    modelIoLog = modelIoOn
      ? openModelIoLog(meta?.workspaceRoot, {
          at: runStartedAt,
          sessionId: meta?.sessionId ?? id,
          runId: run.runId ?? id,
        })
      : undefined;
    if (modelIoLog) {
      setActiveModelIoSink(modelIoLog);
      appendRunLog(logsDir, `model_io ${modelIoLog.path}`);
    }

    try {
      for await (const event of run.events) {
        sessionLog?.appendEvent(event);
        writeNdjson(res, { op: 'event', id, event });
      }
      const result = await run.result;
      if (result.status !== 'suspended') {
        sessionLog?.finish(result);
      }
      if (result.status === 'completed' && meta?.workspaceRoot) {
        const promptLabel = (meta.prompt ?? 'run').trim() || 'run';
        try {
          await recordCheckpointLabel({
            workspaceRoot: meta.workspaceRoot,
            label: `After: ${promptLabel.slice(0, 40)}`,
          });
        } catch {
          // Label snapshot is best-effort; never fail the run stream.
        }
      }
      writeNdjson(res, { op: 'result', id, result });
      appendRunLog(logsDir, `run_ok id=${id} status=${result.status}`);
    } finally {
      req?.off('close', onClientGone);
      res.off('close', onClientGone);
      setActiveModelIoSink(undefined);
      modelIoLog?.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendRunLog(logsDir, `run_failed id=${id} ${message}`, {
      model: meta?.model ?? process.env.MITII_MODEL ?? '',
      baseUrl: meta?.baseUrl ?? process.env.MITII_BASE_URL ?? '',
    });
    writeNdjson(res, { op: 'error', id, error: 'run_failed', message });
  } finally {
    mcpManager.setToolResultListener(undefined);
  }
  res.end();
}
