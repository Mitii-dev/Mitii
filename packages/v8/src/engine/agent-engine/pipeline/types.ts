import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { RepoBuildStateComparison, VerificationResult } from "../../../modules/verification";

import type { VerificationGateDecision } from "../actions";
import type { AgentReasonCode } from "../contracts";
import type { PendingApprovalState } from "../internal/RunCheckpoint";
import type { ToolCallCache } from "../internal/ToolCallCache";

export type ToolCallOutcome =
  | { kind: "message"; message: ModelMessage }
  | {
      kind: "approval_required";
      toolName: string;
      callId: string;
      fingerprint: string;
      arguments: unknown;
      paths: string[];
    };

export type ToolLoopOutcome =
  | {
      kind: "completed";
      answer: string;
      changedFiles: string[];
      mutationCheckpointIds: string[];
      messages: ModelMessage[];
      toolCache: ToolCallCache;
      /** Authority as of the end of the loop — may have been refreshed mid-run. */
      decision: ExecutionDecision;
    }
  | {
      kind: "approval_required";
      messages: ModelMessage[];
      toolCache: ToolCallCache;
      pendingApproval: PendingApprovalState;
      changedFiles: string[];
      mutationCheckpointIds: string[];
      answer?: string;
      /** Authority as of the end of the loop — may have been refreshed mid-run. */
      decision: ExecutionDecision;
    }
  | { kind: "cancelled" }
  | {
      kind: "budget_exhausted";
      answer?: string;
      message: string;
      changedFiles: string[];
      mutationCheckpointIds: string[];
    }
  | {
      kind: "failed";
      answer?: string;
      extraReasons: AgentReasonCode[];
      error: { code: string; message: string };
    };

export type VerificationGateOutcome =
  | {
      kind: "ok";
      acceptKind: Extract<
        VerificationGateDecision,
        { action: "accept" }
      >["acceptKind"];
      verification?: VerificationResult;
      comparison?: RepoBuildStateComparison;
    }
  | {
      kind: "failed";
      repairable: boolean;
      /** Distinguishes a repairable failure from a hard block/cancel/infra-unavailable reject. */
      rejectKind: Extract<
        VerificationGateDecision,
        { action: "reject" }
      >["rejectKind"];
      error: { code: string; message: string };
      verification?: VerificationResult;
      /** Before/after diagnostic diff, when a saved before-state exists. */
      comparison?: RepoBuildStateComparison;
    };
