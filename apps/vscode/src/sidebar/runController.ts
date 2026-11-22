import type { MitiiResumeInput } from '@mitii/sdk';

import type { SuspensionPayload, WebviewToHostMessage } from '../protocol.js';
import type { SidebarContext } from './context.js';
import { handleAsk } from './runAsk.js';
import type { AskMessage } from './runFinalize.js';
import {
  autoApprovePendingApproval,
  handleResume,
  resolveInlineDiffDecision,
  waitForSuspensionResume,
} from './runSuspension.js';

/**
 * Run lifecycle owner: starts Ask/Plan/Agent/Review turns, cancels them, and
 * bridges webview approvals back into suspended runs.
 */
export class SidebarRunController {
  constructor(private readonly ctx: SidebarContext) {}

  ask(message: AskMessage): Promise<void> {
    return handleAsk(this.ctx, message);
  }

  cancel(): void {
    this.ctx.session.pendingFixFindingKeys = [];
    this.ctx.session.runCancel?.cancel();
  }

  resume(message: Extract<WebviewToHostMessage, { type: 'resume' }>): void {
    handleResume(this.ctx, message);
  }

  waitForSuspensionResume(
    suspension: SuspensionPayload,
  ): Promise<MitiiResumeInput | 'stop'> {
    return waitForSuspensionResume(this.ctx, suspension);
  }

  resolveInlineDiffDecision(
    approvalId: string,
    decision: 'approved' | 'denied',
  ): void {
    resolveInlineDiffDecision(this.ctx, approvalId, decision);
  }

  autoApprovePending(approvalMode: string | undefined): void {
    autoApprovePendingApproval(this.ctx, approvalMode);
  }
}
