import { z } from "zod";

import { taskListSchema } from "../../../modules/task-list";
import { runtimeRunStatusSchema } from "./RuntimeRunStatus";

export const runtimeToolInvocationSketchSchema = z
  .object({
    invocationId: z.string().min(1),
    toolId: z.string().min(1),
    status: z.enum(["succeeded", "failed", "pending"]),
    /** Path/pattern/argv preview for bridge replay + logs. */
    summary: z.string().min(1).max(500).optional(),
    reasonCode: z.string().min(1).max(80).optional(),
    outputPreview: z.string().max(1_000).optional(),
    /** Process tool exitCode — authoritative for verify evidence. */
    exitCode: z.number().int().optional(),
  })
  .strict();

export const runtimeUsageSketchSchema = z
  .object({
    modelCalls: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    loopIterations: z.number().int().nonnegative(),
    heartbeats: z.number().int().nonnegative().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cacheHitTokens: z.number().int().nonnegative().optional(),
    cacheMissTokens: z.number().int().nonnegative().optional(),
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
    reasonCodes: z.array(z.string().min(1)).max(24).optional(),
    checksRun: z.array(z.string().min(1)).max(32).optional(),
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

/** Host-facing mutation approval bag (Desktop ApprovalCard / resume). */
export const runtimePendingApprovalSchema = z
  .object({
    approvalId: z.string().min(1),
    fingerprint: z.string().min(1),
    toolName: z.string().min(1),
    callId: z.string().min(1),
    paths: z.array(z.string().min(1)).max(32).optional(),
    arguments: z.unknown().optional(),
    summary: z.string().min(1).max(500).optional(),
  })
  .strict();

/** Plan/checklist progress for host PlanFollow navigation. */
export const runtimeProgressSketchSchema = z
  .object({
    planCompletedCount: z.number().int().nonnegative(),
    planTotalCount: z.number().int().nonnegative(),
    doneCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    nextTitle: z.string().min(1).max(200).optional(),
    nextDetail: z.string().min(1).max(500).optional(),
    openTitles: z.array(z.string().min(1).max(200)).max(6).default([]),
  })
  .strict();

/** Structured “what’s next” after a partial slice (no continue_required). */
export const runtimeNextActionSchema = z
  .object({
    kind: z.enum(["continue_checklist", "next_campaign_scope"]),
    prompt: z.string().min(1).max(500),
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
    /** Pending mutate tool awaiting host approve/deny. */
    pendingApproval: runtimePendingApprovalSchema.optional(),
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
    /**
     * Plan artifact for plan_approval_required (host ApprovalCard).
     * Kept loose so runtime does not re-own planning schemas.
     */
    plan: z.record(z.unknown()).optional(),
    /** Live checklist when derived/settled during the run. */
    taskList: taskListSchema.optional(),
    /** Plan/checklist progress for host navigation. */
    progress: runtimeProgressSketchSchema.optional(),
    /** Durable notebook of finished plan step ids. */
    completedPlanStepIds: z.array(z.string().min(1)).max(200).optional(),
    /** Host CTA after a partial slice. */
    nextAction: runtimeNextActionSchema.optional(),
    /** User-facing clarification question when gateKind is clarification_required. */
    clarificationPrompt: z.string().min(1).max(2_000).optional(),
    /** Why clarification_required fired (hollow_plan, scope_fork, …). */
    clarifyOrigin: z.string().min(1).max(64).optional(),
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
export type RuntimeProgressSketch = z.infer<typeof runtimeProgressSketchSchema>;
export type RuntimeNextAction = z.infer<typeof runtimeNextActionSchema>;
export type RuntimeRunResult = z.infer<typeof runtimeRunResultSchema>;
