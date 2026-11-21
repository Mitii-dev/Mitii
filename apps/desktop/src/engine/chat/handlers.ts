/** Prompt / resume request handlers (transport glue over MitiiClient). */

import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  mapUiModeToAgentMode,
} from '@mitii/host';
import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type MitiiClient,
  type MitiiResumeInput,
} from '@mitii/sdk';
import {
  createPromptId,
  parseDesktopPromptBody,
  parseDesktopResumeBody,
} from '../../shared/protocol.js';
import {
  sendJson,
} from '../http/httpUtils.js';
import {
  buildStartInput,
  attachContextEnvironment,
  resolveApprovalPreset,
} from './startInput.js';
import {
  streamRun,
} from './streamRun.js';

export async function handlePrompt(
  client: MitiiClient,
  workspaceRoot: string,
  body: unknown,
  res: ServerResponse,
  req: IncomingMessage,
): Promise<void> {
  const parsed = parseDesktopPromptBody(body);
  if ('error' in parsed) {
    sendJson(res, 400, { op: 'error', error: parsed.error });
    return;
  }
  const id = createPromptId(parsed.id);
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const startInput = await attachContextEnvironment(
    buildStartInput(record, parsed, workspaceRoot),
    workspaceRoot,
  );
  // Log / NDJSON mode must match V8 start (Database+readwrite → agent), not
  // mapUiModeToAgentMode which always maps UI "database" → ask.
  const streamMode = startInput.mode ?? mapUiModeToAgentMode(parsed.mode ?? 'ask');
  await streamRun(id, streamMode, () => client.start(startInput), res, {
    model: startInput.model,
    baseUrl: process.env.MITII_BASE_URL,
    workspaceRoot,
    prompt: parsed.prompt,
    sessionId: parsed.sessionId ?? id,
    conversationCount: startInput.conversation?.length ?? 0,
  }, req);
}

export async function handleResume(
  client: MitiiClient,
  workspaceRoot: string,
  body: unknown,
  res: ServerResponse,
  req: IncomingMessage,
): Promise<void> {
  const parsedBody = parseDesktopResumeBody(body);
  if (!parsedBody.ok) {
    sendJson(res, 400, { op: 'error', error: parsedBody.error });
    return;
  }
  const record = parsedBody.value;
  const id = createPromptId(record.id);
  const mode = record.mode ?? 'ask';
  const sessionId = record.sessionId ?? id;

  const resume: MitiiResumeInput = {
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    runId: record.runId,
  };
  if (record.approval) resume.approval = record.approval;
  if (record.clarificationAnswer) {
    resume.clarificationAnswer = record.clarificationAnswer;
  }
  if (record.planDecision) resume.planDecision = record.planDecision;
  if (record.grantExpansion) resume.grantExpansion = record.grantExpansion;
  if (record.continueDecision) {
    resume.continueDecision = {
      decision: record.continueDecision.decision,
      ...(record.continueDecision.guidance
        ? { guidance: record.continueDecision.guidance }
        : {}),
    };
  }
  if (typeof record.approvalPreset === 'string') {
    resume.approvalMode = resolveApprovalPreset(record.approvalPreset)
      .approvalMode;
  }

  const hasDecision = Boolean(
    resume.approval ||
      resume.clarificationAnswer ||
      resume.planDecision ||
      resume.grantExpansion ||
      resume.continueDecision,
  );
  if (!hasDecision) {
    sendJson(res, 400, { op: 'error', error: 'resume_decision_required' });
    return;
  }

  await streamRun(id, mode, () => client.resume(resume), res, {
    workspaceRoot,
    sessionId,
    prompt: record.prompt ?? '(resume)',
    model: process.env.MITII_MODEL,
    baseUrl: process.env.MITII_BASE_URL,
  }, req);
}
