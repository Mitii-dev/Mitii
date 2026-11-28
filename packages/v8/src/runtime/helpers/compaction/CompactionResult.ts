import type { ModelMessage } from "../../../modules/model-gateway";
import type { ModelLoopCompactionPressure, ModelLoopCompactionThresholds } from "./CompactionThresholds";


export const COMPACTION_LADDER_STAGES = [
  "soft_tool_stubs",
  "drop_oldest_turns",
  "dropped_turn_summary",
  "hard_tool_compact",
  "reinject_established_facts",
  "reinject_memory",
] as const;

export type CompactionLadderStage = (typeof COMPACTION_LADDER_STAGES)[number];


export interface ModelLoopCompactionResult {
  messages: ModelMessage[];
  usedTokens: number;
  omittedTokens: number;
  truncatedTokens: number;
  compacted: boolean;
  pressure: ModelLoopCompactionPressure;
  thresholds: ModelLoopCompactionThresholds;
  summarizedDroppedTurns: boolean;
  reinjectedMemory: boolean;
  reinjectedEstablishedFacts: boolean;
  /** Ladder stages that mutated history this turn (provenance). */
  stagesApplied: CompactionLadderStage[];
  /**
   * Turns removed from model projection this compaction (dual-store projection).
   * Callers MUST archive these; they leave Session History projection only.
   */
  droppedMessages: ModelMessage[];
}

