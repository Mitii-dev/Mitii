import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type MitiiResumeInput,
} from '@mitii/sdk';

import { resolveApprovalPolicy } from '../hostAsk.js';
import type {
  SuspensionPayload,
  WebviewToHostMessage,
} from '../protocol.js';
import type { SidebarContext } from './context.js';

export function handleResume(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'resume' }>,
): void {
  if (!ctx.session.pendingResume) return;
  const { resolve } = ctx.session.pendingResume;
  ctx.session.pendingResume = undefined;
  ctx.session.pendingSuspension = undefined;
  if (message.clarificationAnswer?.trim()) {
    ctx.post({ type: 'run.resumed', runId: message.runId });
    ctx.session.lastSuspensionRunId = undefined;
    resolve({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: message.runId,
      clarificationAnswer: message.clarificationAnswer.trim(),
    });
    return;
  }
  if (message.approval) {
    ctx.host.inlineDiff.setPending(undefined);
    ctx.host.onInlineDiffPending(false);
    ctx.post({ type: 'run.resumed', runId: message.runId });
    ctx.session.lastSuspensionRunId = undefined;
    resolve({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: message.runId,
      approval: message.approval,
    });
    return;
  }
  if (message.planDecision) {
    ctx.post({ type: 'run.resumed', runId: message.runId });
    ctx.session.lastSuspensionRunId = undefined;
    resolve({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: message.runId,
      planDecision: message.planDecision,
    });
    return;
  }
  if (message.grantExpansion) {
    ctx.post({ type: 'run.resumed', runId: message.runId });
    ctx.session.lastSuspensionRunId = undefined;
    resolve({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: message.runId,
      grantExpansion: message.grantExpansion,
    });
    return;
  }
  if (message.continueDecision) {
    ctx.post({ type: 'run.resumed', runId: message.runId });
    ctx.session.lastSuspensionRunId = undefined;
    resolve({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: message.runId,
      continueDecision: {
        decision: message.continueDecision.decision,
        ...(message.continueDecision.guidance?.trim()
          ? { guidance: message.continueDecision.guidance.trim() }
          : {}),
      },
    });
    return;
  }
  resolve('stop');
}

export function waitForSuspensionResume(
  ctx: SidebarContext,
  suspension: SuspensionPayload,
): Promise<MitiiResumeInput | 'stop'> {
  ctx.session.lastSuspensionRunId = suspension.runId;
  ctx.session.pendingSuspension = suspension;
  ctx.post({ type: 'run.suspended', suspension });
  return new Promise((resolve) => {
    ctx.session.pendingResume = { resolve };
    // Apply access changes made while a model/tool call was still in flight.
    autoApprovePendingApproval(ctx, ctx.session.liveApprovalMode);
  });
}

/** Auto-resume a pending tool approval once the access mode allows it. */
export function autoApprovePendingApproval(
  ctx: SidebarContext,
  approvalMode: string | undefined,
): void {
  const pending = ctx.session.pendingSuspension;
  if (
    !ctx.session.pendingResume ||
    !pending ||
    pending.kind !== 'approval_required' ||
    !pending.approval?.approvalId ||
    resolveApprovalPolicy(approvalMode).approvalMode !== 'never'
  ) {
    return;
  }

  const { resolve } = ctx.session.pendingResume;
  ctx.session.pendingResume = undefined;
  ctx.session.pendingSuspension = undefined;
  ctx.session.lastSuspensionRunId = undefined;
  ctx.host.inlineDiff.setPending(undefined);
  ctx.host.onInlineDiffPending(false);
  ctx.post({ type: 'run.resumed', runId: pending.runId });
  resolve({
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    runId: pending.runId,
    approvalMode: 'never',
    approval: {
      approvalId: pending.approval.approvalId,
      decision: 'approved',
    },
  });
}


export function resolveInlineDiffDecision(
  ctx: SidebarContext,
  approvalId: string,
  decision: 'approved' | 'denied',
): void {
  ctx.host.onInlineDiffPending(false);
  if (!ctx.session.pendingResume || !ctx.session.lastSuspensionRunId) return;
  const runId = ctx.session.lastSuspensionRunId;
  const { resolve } = ctx.session.pendingResume;
  ctx.session.pendingResume = undefined;
  ctx.session.pendingSuspension = undefined;
  ctx.session.lastSuspensionRunId = undefined;
  ctx.post({ type: 'run.resumed', runId });
  resolve({
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    runId,
    approval: { approvalId, decision },
  });
}
