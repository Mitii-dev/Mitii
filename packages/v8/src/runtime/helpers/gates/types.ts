import type { GateKind, GatePhase, TerminalKind } from "./constants";
import type { GateVerdict } from "./kinds";

/**
 * Structured inputs for predicates — never raw user/benchmark strings (§2.2).
 * Flags grow as call sites evacuate; keep optional + additive.
 */
export interface GateContext {
  phase: GatePhase;
  runId: string;
  requestId?: string;
  mode?: "ask" | "plan" | "agent";
  route?: string;
  planningDepth?: "none" | "internal" | "visible";
  planGate?: "none" | "required_before_execute";
  runDisposition?: string;
  /** Plan / clarify structured flags */
  hasClarifyDraft?: boolean;
  scopeChoiceResolved?: boolean;
  qualityFloor?: boolean;
  askNeedsScopeFork?: boolean;
  forceCampaignPhaseLock?: boolean;
  planStrategy?: string;
  hollowPlan?: boolean;
  /** Tool / budget / verify */
  needsGrantExpansion?: boolean;
  needsMutationApproval?: boolean;
  needsExternalSideEffectApproval?: boolean;
  authOrDependencyMissing?: boolean;
  providerUnavailable?: boolean;
  budgetHardWall?: boolean;
  stalledOrBlocked?: boolean;
  incompleteProgress?: boolean;
  verificationRepairCapped?: boolean;
  checkpointConflict?: boolean;
  /** Policy toggles for extended kinds */
  enableExtendedGates?: boolean;
}

export type GatePredicate = (ctx: GateContext) => GateVerdict | undefined;

export type ResumeReenter =
  | "decide"
  | "after_plan"
  | "tool_settle"
  | "loop"
  | "verify"
  | "complete"
  | "orient";

export interface ResumePlan {
  reenter: ResumeReenter;
  replate?: boolean;
  replayTool?: boolean;
  guidance?: string;
  terminal?: TerminalKind;
  reasonCodes?: string[];
}

export interface ApplyGateResult {
  status: "suspended" | "completed";
  kind?: GateKind;
  terminal?: TerminalKind;
  checkpointSaved: boolean;
  reasonCodes: string[];
  payload: Record<string, unknown>;
}

export interface GateCheckpointStorePort {
  save(checkpoint: RuntimeGateCheckpoint): Promise<void>;
  /** Optional hydrate for resume — thin until StoreManager owns full restore. */
  load?(runId: string): Promise<RuntimeGateCheckpoint | undefined>;
}

/** Minimal checkpoint shape for the hub (engine maps to AgentRunCheckpoint). */
export interface RuntimeGateCheckpoint {
  runId: string;
  requestId: string;
  suspensionKind: GateKind;
  payload: Record<string, unknown>;
  reasonCodes: string[];
  suspendedAtMs: number;
}
