/**
 * Context Epoch formulae injected from OpenCode CONTEXT.md into Mitii agent-engine.
 *
 * - One immutable Baseline System Context per epoch (provider-cache friendly).
 * - Mid-conversation updates are chronological admissions, not baseline rewrites.
 * - Compaction / incompatible transition requests replacement; next turn rebuilds.
 */

export interface ContextEpochSnapshot {
  /** Stable source key -> content hash. */
  readonly sources: Readonly<Record<string, string>>;
}

export interface ContextEpoch {
  readonly epochId: string;
  readonly runId: string;
  /** Exact baseline system text admitted at epoch start. */
  readonly baselineSystemText: string;
  readonly baselineHash: string;
  readonly structuredSnapshot: ContextEpochSnapshot;
  readonly createdAtMs: number;
  /** Set when compaction or an incompatible transition requires a fresh baseline. */
  readonly replacementRequested: boolean;
}

export type ContextEpochReconcileResult =
  | { kind: "unchanged"; epoch: ContextEpoch }
  | {
      kind: "updated";
      epoch: ContextEpoch;
      changedSourceKeys: string[];
    }
  | { kind: "replace_ready"; epoch: ContextEpoch }
  | { kind: "replace_blocked"; epoch: ContextEpoch; reason: string };

export interface ContextEpochStorePort {
  load(runId: string): Promise<ContextEpoch | undefined>;
  save(epoch: ContextEpoch): Promise<void>;
  delete(runId: string): Promise<void>;
}
