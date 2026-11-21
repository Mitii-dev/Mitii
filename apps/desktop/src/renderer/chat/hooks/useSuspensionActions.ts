/** Approve, deny, clarify, continue and stop suspended runs. */

import { useEffect } from 'react';
import type { useChatThreadState } from './useChatThreadState.js';
import type { useRunResume } from './useRunResume.js';
import type { useComposerState } from './useComposerState.js';

export function useSuspensionActions(deps: Pick<
    ReturnType<typeof useChatThreadState>,
    'suspension' | 'busy' | 'setSuspension'
  > &
  Pick<
    ReturnType<typeof useRunResume>,
    'runResume'
  > &
  Pick<
    ReturnType<typeof useComposerState>,
    'approvalMode' | 'pendingAutoContinue' | 'setPendingAutoContinue'
  >) {
  const {
    suspension,
    busy,
    setSuspension,
    runResume,
    approvalMode,
    pendingAutoContinue,
    setPendingAutoContinue,
  } = deps;

  const onApproveSuspension = () => {
    if (!suspension) return;
    if (suspension.kind === 'plan_approval_required') {
      void runResume({
        runId: suspension.runId,
        planDecision: { decision: 'approved' },
      });
      return;
    }
    if (suspension.kind === 'grant_expansion_required') {
      const expansionId = suspension.grantExpansion?.expansionId;
      if (!expansionId) return;
      void runResume({
        runId: suspension.runId,
        grantExpansion: { expansionId, decision: 'approved' },
      });
      return;
    }
    const approvalId = suspension.approval?.approvalId;
    if (!approvalId) return;
    void runResume({
      runId: suspension.runId,
      approval: { approvalId, decision: 'approved' },
      approvalPreset: approvalMode,
    });
  };

  const onDenySuspension = () => {
    if (!suspension) return;
    if (suspension.kind === 'plan_approval_required') {
      void runResume({
        runId: suspension.runId,
        planDecision: { decision: 'rejected' },
      });
      return;
    }
    if (suspension.kind === 'grant_expansion_required') {
      const expansionId = suspension.grantExpansion?.expansionId;
      if (!expansionId) return;
      void runResume({
        runId: suspension.runId,
        grantExpansion: { expansionId, decision: 'denied' },
      });
      return;
    }
    const approvalId = suspension.approval?.approvalId;
    if (!approvalId) return;
    void runResume({
      runId: suspension.runId,
      approval: { approvalId, decision: 'denied' },
      approvalPreset: approvalMode,
    });
  };

  const onClarifySuspension = (answer: string) => {
    if (!suspension || !answer.trim()) return;
    void runResume({
      runId: suspension.runId,
      clarificationAnswer: answer,
    });
  };

  const onContinueSuspension = (guidance?: string) => {
    if (!suspension) return;
    void runResume({
      runId: suspension.runId,
      continueDecision: {
        decision: 'continue',
        ...(guidance ? { guidance } : {}),
      },
    });
  };

  // Pilot: auto-Continue stall walls without flashing the ApprovalCard.
  useEffect(() => {
    if (!pendingAutoContinue) return;
    if (pendingAutoContinue.kind !== 'continue_required') return;
    if (busy) return;
    const runId = pendingAutoContinue.runId;
    setPendingAutoContinue(null);
    void runResume({
      runId,
      continueDecision: { decision: 'continue' },
    });
  }, [pendingAutoContinue, busy, runResume]);

  const onStopSuspension = () => {
    if (!suspension) return;
    if (suspension.kind === 'clarification_required') {
      setSuspension(null);
      return;
    }
    if (suspension.kind === 'grant_expansion_required') {
      onDenySuspension();
      return;
    }
    if (
      suspension.kind === 'approval_required' ||
      (suspension.approval &&
        suspension.kind !== 'plan_approval_required' &&
        suspension.kind !== 'continue_required')
    ) {
      onDenySuspension();
      return;
    }
    void runResume({
      runId: suspension.runId,
      continueDecision: { decision: 'stop' },
    });
  };

  return {
    onApproveSuspension,
    onDenySuspension,
    onClarifySuspension,
    onContinueSuspension,
    onStopSuspension,
  };
}
