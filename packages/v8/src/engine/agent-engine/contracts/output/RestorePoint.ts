import { z } from "zod";

import { modelMessageSchema } from "../../../../modules/model-gateway";
import { planArtifactSchema } from "../../../../modules/planning";
import { taskListSchema } from "../../../../modules/task-list";
import { AGENT_MODES } from "../../../../modules/request-intake";

/**
 * Durable pre-mutation file snapshot embedded in a RestorePoint.
 * Same shape as tool-runtime MutationCheckpoint; owned here so restore
 * survives process restart without the in-memory registry.
 */
export const restorePointFileSnapshotSchema = z.discriminatedUnion("kind", [
  z
    .object({
      relativePath: z.string().min(1),
      kind: z.literal("existing"),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      relativePath: z.string().min(1),
      kind: z.literal("missing"),
    })
    .strict(),
  z
    .object({
      relativePath: z.string().min(1),
      kind: z.literal("directory"),
    })
    .strict(),
]);

export type RestorePointFileSnapshot = z.infer<
  typeof restorePointFileSnapshotSchema
>;

export const restorePointMutationSnapshotSchema = z
  .object({
    checkpointId: z.string().min(1),
    workspaceRoot: z.string().min(1),
    files: z.array(restorePointFileSnapshotSchema),
    createdAt: z.string().min(1),
  })
  .strict();

export type RestorePointMutationSnapshot = z.infer<
  typeof restorePointMutationSnapshotSchema
>;

/**
 * Durable undo point written after each successful mutation batch.
 *
 * schemaVersion is literal 1 — unknown versions are rejected (no dual reader).
 * Hosts that still have old on-disk shapes should delete `.mitii/checkpoints`.
 */
export const restorePointSchema = z
  .object({
    schemaVersion: z.literal(1),
    restorePointId: z.string().min(1),
    runId: z.string().min(1),
    requestId: z.string().min(1),
    createdAt: z.string().min(1),
    /** Interaction mode frozen at write time — restore never escalates grants. */
    interactionMode: z.enum(AGENT_MODES),
    /** Pre-mutation snapshot for the mutation that just succeeded. */
    mutationSnapshot: restorePointMutationSnapshotSchema,
    /**
     * Ordered mutation checkpoint ids for this run up to and including
     * `mutationSnapshot.checkpointId` (oldest → newest).
     */
    mutationCheckpointIds: z.array(z.string().min(1)),
    /** Conversation after the successful mutation tool result was recorded. */
    messages: z.array(modelMessageSchema),
    /** Opaque tool-cache entries (callId → ToolResult JSON). */
    toolCacheEntries: z.array(z.tuple([z.string().min(1), z.unknown()])),
    changedFiles: z.array(z.string().min(1)),
    plan: planArtifactSchema.optional(),
    taskList: taskListSchema.optional(),
    completedPlanStepIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type RestorePoint = z.infer<typeof restorePointSchema>;

export const restorePointSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    restorePointId: z.string().min(1),
    runId: z.string().min(1),
    createdAt: z.string().min(1),
    mutationCheckpointId: z.string().min(1),
    changedFileCount: z.number().int().nonnegative(),
  })
  .strict();

export type RestorePointSummary = z.infer<typeof restorePointSummarySchema>;

export const agentEngineRestoreInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    restorePointId: z.string().min(1),
    /**
     * Absolute workspace root used to apply file restore.
     * Must match the mutation snapshot workspace when provided.
     */
    workspaceRoot: z.string().min(1),
  })
  .strict();

export type AgentEngineRestoreInput = z.infer<
  typeof agentEngineRestoreInputSchema
>;

export const agentEngineRestoreResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    restorePointId: z.string().min(1),
    restoredFiles: z.array(z.string()),
    /** Restore points newer than the target that were also rolled back. */
    rolledBackRestorePointIds: z.array(z.string().min(1)),
    interactionMode: z.enum(AGENT_MODES),
    messages: z.array(modelMessageSchema),
    changedFiles: z.array(z.string()),
    plan: planArtifactSchema.optional(),
    taskList: taskListSchema.optional(),
  })
  .strict();

export type AgentEngineRestoreResult = z.infer<
  typeof agentEngineRestoreResultSchema
>;
