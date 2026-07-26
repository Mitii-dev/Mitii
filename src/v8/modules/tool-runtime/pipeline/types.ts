import type { SessionBudget } from "../internal/SessionBudget";
import type { ToolRegistry } from "../internal/ToolRegistry";

export interface ToolExecuteOptions {
  signal?: AbortSignal;
  /** When provided, tracks grant limits across calls. */
  budget?: SessionBudget;
}

export interface ToolRuntimePipelineOptions {
  /**
   * Tool catalog + executors. Defaults to built-in Phase 4 tools.
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
