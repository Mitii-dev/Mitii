import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { VerificationRecord } from "../../../modules/verification";

import type {
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunBudget,
  AgentRunResult,
} from "../contracts";
import type { AgentRunCheckpoint } from "../internal/RunCheckpoint";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";

export type ResumeFinish = (
  partial: Omit<
    AgentRunResult,
    | "schemaVersion"
    | "runId"
    | "requestId"
    | "usage"
    | "durationMs"
    | "warnings"
    | "reasonCodes"
  > & {
    reasonCodes?: AgentReasonCode[];
    warnings?: string[];
  },
) => AgentRunResult;

export type ResumeHandlerContext = {
  runtime: AgentEngineRuntime;
  runId: string;
  requestId: string;
  input: AgentEngineResumeInput;
  checkpoint: AgentRunCheckpoint;
  startInput: AgentEngineStartInput;
  decision: ExecutionDecision;
  bus: EventBus;
  signal: AbortSignal;
  getCancelReason: () => string | undefined;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  taskListRef: TaskListRef;
  windowPolicy: WindowPolicy;
  pinnedState: AgentRunCheckpoint["pinnedState"];
  finish: ResumeFinish;
  cancelledResult: () => Promise<AgentRunResult>;
  repoBuildStateAfter: AgentRunCheckpoint["repoBuildStateAfter"];
  setRepoBuildStateAfter: (
    state: NonNullable<AgentRunCheckpoint["repoBuildStateAfter"]>,
  ) => void;
  setVerificationRecord: (record: VerificationRecord) => void;
  resumeBudget: AgentRunBudget;
  excludedWaitMs: number;
};
