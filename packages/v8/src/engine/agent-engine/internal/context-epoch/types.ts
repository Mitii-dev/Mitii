/**
 * Context Epoch formulae injected from OpenCode CONTEXT.md into Mitii agent-engine.
 *
 * - One immutable Baseline System Context per epoch (provider-cache friendly).
 * - Mid-conversation updates are chronological admissions, not baseline rewrites.
 * - Compaction / incompatible transition requests replacement; next turn rebuilds.
 */

import type { SystemContextSnapshot } from "../system-context";

export interface ContextEpochSnapshot {
  /**
   * OpenCode Context Snapshot: encoded source values (+ optional removal text).
   * Legacy checkpoints may store bare hash strings; admit normalizes on load.
   */
  readonly sources: SystemContextSnapshot | Readonly<Record<string, string>>;
}

export interface ContextEpoch {
  readonly epochId: string;
  readonly runId: string;
  /** Exact baseline system text admitted at epoch start (cache prefix). */
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
      /** Mid-Conversation System Message text (OpenCode Updated.text). */
      midConversationText: string;
    }
  | { kind: "replace_ready"; epoch: ContextEpoch }
  | { kind: "replace_blocked"; epoch: ContextEpoch; reason: string };

export interface ContextEpochStorePort {
  load(runId: string): Promise<ContextEpoch | undefined>;
  save(epoch: ContextEpoch): Promise<void>;
  delete(runId: string): Promise<void>;
}

export interface ContextEpochAdmitResult {
  readonly epoch: ContextEpoch;
  /** When set, pin messages[0] system content to this exact text. */
  readonly pinBaseline: string | undefined;
  /** Mid-conversation system message to append (chronological admission). */
  readonly midConversationText: string | undefined;
  /** Strip prior mid-conversation system messages from projected history. */
  readonly stripPriorMidConversation: boolean;
}
