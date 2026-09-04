import type { SessionBudget } from "../internal/SessionBudget";
import type { ToolRegistry } from "../internal/ToolRegistry";
import type { ToolApprovalToken } from "../internal/mutation/assertApprovalSatisfied";
import type {
  ShadowAuthorizeResult,
  ShadowGrantAuthorizer,
} from "../internal/shadow/ShadowGrantAuthorizer";

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
  /**
   * Optional model-facing content budget (WindowPolicy.toolResultContentChars).
   * Forwarded into tool execution so read tools can window early.
   */
  maxContentChars?: number;
  /**
   * Optional shadow authorizer. Default is structural forbid-wins shadow
   * that logs disagreements without overriding ValidateGrant.
   */
  shadowAuthorizer?: ShadowGrantAuthorizer;
  /** When true, shadow Deny overrides primary grant allow (kill-switch). */
  enforceShadowAuthorization?: boolean;
  /** Receives shadow audit events (disagreement / cedar snapshot). */
  onShadowAuthorize?: (event: {
    toolName: string;
    primaryAllowed: boolean;
    shadow: ShadowAuthorizeResult;
    disagreed: boolean;
  }) => void;
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
