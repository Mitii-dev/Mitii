import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { ToolResult } from "../../tool-runtime";

import type { AgentEngineStartInput } from "../contracts/input/AgentEngineInput";
import type {
  AgentReasonCode,
  AgentRunUsage,
} from "../contracts/output/AgentRunResult";

export interface PendingApprovalState {
  approvalId: string;
  fingerprint: string;
  toolName: string;
  callId: string;
  arguments: unknown;
  paths: string[];
}

/**
 * Persisted run checkpoint for suspension/resume.
 * Completed tool callIds are retained so resume does not replay them.
 */
export interface AgentRunCheckpoint {
  runId: string;
  requestId: string;
  suspensionKind: "approval_required" | "clarification_required";
  input: AgentEngineStartInput;
  decision: ExecutionDecision;
  pinnedState?: RepositoryStateReference;
  messages: ModelMessage[];
  toolCacheEntries: Array<[string, ToolResult]>;
  pendingApproval?: PendingApprovalState;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  usage: AgentRunUsage;
  startedAtMs: number;
}

export interface AgentEngineRunCheckpointStorePort {
  save(checkpoint: AgentRunCheckpoint): Promise<void>;
  load(runId: string): Promise<AgentRunCheckpoint | undefined>;
  delete(runId: string): Promise<void>;
}
