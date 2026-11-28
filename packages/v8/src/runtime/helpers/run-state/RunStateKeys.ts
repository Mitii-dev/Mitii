/**
 * Known RunState (storeroom) slice keys (§11.10).
 * StoreManager stays stringly; this catalog documents the live inventory.
 */

export const RUN_STATE_KEYS = [
  "situationPack",
  "assessment",
  "decision",
  "contextBundle",
  "planArtifact",
  "planFingerprint",
  "planPipeline",
  "planExit",
  "planSteer",
  "taskList",
  "taskHandoffs",
  "verifyBaseline",
  "verifyFinish",
  "lastVerify",
  "toolJournal",
  "lastAssistantText",
  "mcpServerIds",
  "executionSeed",
  "windowPolicy",
  "windowBand",
] as const;

export type RunStateKey = (typeof RUN_STATE_KEYS)[number];

export function isRunStateKey(key: string): key is RunStateKey {
  return (RUN_STATE_KEYS as readonly string[]).includes(key);
}
