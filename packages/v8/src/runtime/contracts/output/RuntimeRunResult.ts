import { z } from "zod";

import { runtimeRunStatusSchema } from "./RuntimeRunStatus";

export const runtimeToolInvocationSketchSchema = z
  .object({
    invocationId: z.string().min(1),
    toolId: z.string().min(1),
    status: z.enum(["succeeded", "failed", "pending"]),
  })
  .strict();

export const runtimeUsageSketchSchema = z
  .object({
    modelCalls: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    loopIterations: z.number().int().nonnegative(),
    heartbeats: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Thin verify-finish sketch (full VerificationRunner still module-owned). */
export const runtimeVerifySketchSchema = z
  .object({
    ranVerify: z.boolean(),
    invalidated: z.boolean(),
    finished: z.boolean(),
    runnerStatus: z
      .enum([
        "passed",
        "failed",
        "skipped",
        "unavailable",
        "repair_requested",
        "repair_capped",
        "blocked",
      ])
      .optional(),
  })
  .strict();

export const runtimeMemoryCommitSketchSchema = z
  .object({
    committed: z.boolean(),
    factCount: z.number().int().nonnegative(),
  })
  .strict();

export const runtimeHandoffSketchSchema = z
  .object({
    fromTaskId: z.string().min(1).optional(),
    toTaskId: z.string().min(1).optional(),
    reason: z.string().min(1),
    doneSummary: z.string().min(1).optional(),
  })
  .strict();

export const runtimeContextSketchSchema = z
  .object({
    summary: z.string().min(1),
    focusPathCount: z.number().int().nonnegative(),
    blockCount: z.number().int().nonnegative(),
  })
  .strict();

export const runtimePromptSketchSchema = z
  .object({
    toolCount: z.number().int().nonnegative(),
    status: z.enum(["complete", "partial", "blocked"]),
  })
  .strict();

export const runtimeRunResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    status: runtimeRunStatusSchema,
    route: z.string().optional(),
    plateId: z.string().optional(),
    grantProfile: z.string().optional(),
    planningDepth: z.string().optional(),
    gateKind: z.string().optional(),
    resumeReenter: z.string().optional(),
    /** Last model text from turn-loop ports when composed. */
    answer: z.string().optional(),
    usage: runtimeUsageSketchSchema.optional(),
    toolInvocations: z.array(runtimeToolInvocationSketchSchema).optional(),
    /** Step 11 verify-finish sketch when the completed path ran (or skipped). */
    verify: runtimeVerifySketchSchema.optional(),
    /** Finish-time memory commit sketch (module owns durable write). */
    memoryCommit: runtimeMemoryCommitSketchSchema.optional(),
    /** MCP servers stamped onto this run. */
    mcpServerIds: z.array(z.string().min(1)).max(32).optional(),
    /** Task handoff sketch when suspending. */
    handoff: runtimeHandoffSketchSchema.optional(),
    /** Enrich context sketch for bridge context_ready. */
    context: runtimeContextSketchSchema.optional(),
    /** packTurn prompt sketch for bridge prompt_ready. */
    prompt: runtimePromptSketchSchema.optional(),
    /** Host Build freshness vs Store plan fingerprint. */
    planFresh: z.boolean().optional(),
    planFingerprint: z.string().min(1).optional(),
    /** True when applyGate / mutation path persisted a RuntimeGateCheckpoint. */
    checkpointSaved: z.boolean().optional(),
    /** True when resume hydrated Store slices from a prior snapshot. */
    storeHydrated: z.boolean().optional(),
    reasonCodes: z.array(z.string()).default([]),
  })
  .strict();

export type RuntimeVerifySketch = z.infer<typeof runtimeVerifySketchSchema>;
export type RuntimeMemoryCommitSketch = z.infer<
  typeof runtimeMemoryCommitSketchSchema
>;
export type RuntimeRunResult = z.infer<typeof runtimeRunResultSchema>;
