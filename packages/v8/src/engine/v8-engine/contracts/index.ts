/**
 * Host-facing contracts stay compatible with agent-engine.
 * v8-engine re-exports them so callers can swap pipelines without new types.
 */
export {
  agentEngineStartInputSchema,
  agentEngineResumeInputSchema,
  agentEngineRestoreInputSchema,
  agentRunBudgetSchema,
  agentRunResultSchema,
  runEventSchema,
  runEvidenceSchema,
  AgentEngineError,
} from "../../agent-engine/contracts";

export type {
  AgentEngineStartInput,
  AgentEngineResumeInput,
  AgentEngineRestoreInput,
  AgentEngineRestoreResult,
  AgentEngineDependencies,
  AgentRunBudget,
  AgentRunHandle,
  AgentRunResult,
  RunEvent,
  RunEvidence,
  RestorePoint,
  RestorePointSummary,
} from "../../agent-engine/contracts";
