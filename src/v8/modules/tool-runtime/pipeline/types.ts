import type { SessionBudget } from "../internal/SessionBudget";
import type { ToolRegistry } from "../internal/ToolRegistry";
import type { ToolApprovalToken } from "../internal/mutation/assertApprovalSatisfied";

export interface ToolExecuteOptions {
  signal?: AbortSignal;
  /** When provided, tracks grant limits across calls. */
  budget?: SessionBudget;
  /** Satisfies grant.approvalMode for mutation tools. */
  approval?: ToolApprovalToken;
  /** Workspace-relative paths dirty before the agent mutation (user edits). */
  dirtyPaths?: readonly string[];
  /** Paths already mutated earlier in this run's transaction set. */
  alreadyMutatedPaths?: readonly string[];
}

export interface ToolRuntimePipelineOptions {
  /**
   * Tool catalog + executors. Defaults to built-in tools.
   * Pass a custom registry (or clone + register) to add tools without
   * modifying this pipeline.
   */
  registry?: ToolRegistry;
}

/** Timing anchors shared across preflight, execute, and result builders. */
export interface CallClock {
  startedAt: Date;
  startedMs: number;
}

export type { ToolApprovalToken };
