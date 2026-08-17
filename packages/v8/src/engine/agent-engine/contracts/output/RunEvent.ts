import { z } from "zod";

import {
  approvalModeSchema,
  decisionTraceSchema,
  executionRouteSchema,
  workspaceEffectSchema,
} from "../../../../modules/decision-policy";
import {
  discoveryBriefSchema,
  planArtifactSchema,
} from "../../../../modules/planning";
import { taskListSchema } from "../../../../modules/task-list";
import { repositoryStateReferenceSchema } from "../../../../modules/repository-state";
import {
  verificationCheckKindSchema,
  verificationCheckOutcomeSchema,
  verificationDiagnosticSeveritySchema,
  verificationReasonCodeSchema,
  verificationStatusSchema,
} from "../../../../modules/verification";

import {
  AGENT_ACTIVE_STAGES,
  AGENT_EVENT_TYPES,
  AGENT_REASON_CODES,
  AGENT_RUN_STATUSES,
  AGENT_SUSPENSION_KINDS,
} from "../../constants";
import { agentRunResultSchema } from "./AgentRunResult";
import { runEvidenceSchema } from "./RunEvidence";

export const agentActiveStageSchema = z.enum(AGENT_ACTIVE_STAGES);
export const agentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);

/**
 * Structured run events. Never include secrets, full prompts, or raw tool
 * payloads — only safe metadata suitable for UI reconstruction.
 */
export const runEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("stage_started"),
      runId: z.string().min(1),
      stage: agentActiveStageSchema,
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("stage_completed"),
      runId: z.string().min(1),
      stage: agentActiveStageSchema,
      at: z.string().datetime(),
      reasonCodes: z.array(z.enum(AGENT_REASON_CODES)).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("decision_made"),
      runId: z.string().min(1),
      route: executionRouteSchema,
      runDisposition: z.enum(["continue", "clarification_required"]),
      maximumWorkspaceEffect: workspaceEffectSchema.optional(),
      approvalMode: approvalModeSchema.optional(),
      pathScopes: z.array(z.string().min(1).max(512)).max(20).optional(),
      trace: decisionTraceSchema.optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("grant_narrowed"),
      runId: z.string().min(1),
      maximumWorkspaceEffect: workspaceEffectSchema,
      approvalMode: approvalModeSchema,
      pathScopes: z.array(z.string().min(1).max(512)).max(20),
      reasonCodes: z.array(z.string().min(1)).max(20).optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("state_pinned"),
      runId: z.string().min(1),
      state: repositoryStateReferenceSchema,
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("skills_ready"),
      runId: z.string().min(1),
      selectedCount: z.number().int().nonnegative(),
      omittedCount: z.number().int().nonnegative(),
      status: z.string().min(1),
      selected: z.array(z.string().min(1).max(160)).max(20).optional(),
      omitted: z.array(z.string().min(1).max(160)).max(20).optional(),
      omittedDetails: z
        .array(
          z
            .object({
              id: z.string().min(1).max(160),
              reason: z.string().min(1).max(80),
              tokens: z.number().int().nonnegative().optional(),
            })
            .strict(),
        )
        .max(20)
        .optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("memory_ready"),
      runId: z.string().min(1),
      selectedCount: z.number().int().nonnegative(),
      omittedCount: z.number().int().nonnegative(),
      status: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("plan_ready"),
      runId: z.string().min(1),
      planningDepth: z.enum(["none", "internal", "visible"]),
      phaseCount: z.number().int().nonnegative(),
      approvalRequired: z.boolean(),
      plan: planArtifactSchema.optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("discovery_started"),
      runId: z.string().min(1),
      objective: z.string().min(1).max(500),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("discovery_progress"),
      runId: z.string().min(1),
      filesRead: z.number().int().nonnegative(),
      searches: z.number().int().nonnegative(),
      summary: z.string().min(1).max(500).optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("discovery_completed"),
      runId: z.string().min(1),
      confidence: z.enum(["low", "medium", "high"]),
      fileCount: z.number().int().nonnegative(),
      surfaceCount: z.number().int().nonnegative(),
      openQuestionCount: z.number().int().nonnegative(),
      brief: discoveryBriefSchema.optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("task_list_updated"),
      runId: z.string().min(1),
      source: z.enum(["plan", "agent", "user", "discovery"]),
      completedCount: z.number().int().nonnegative(),
      totalCount: z.number().int().nonnegative(),
      activeId: z.string().min(1).optional(),
      taskList: taskListSchema,
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("context_ready"),
      runId: z.string().min(1),
      stateToken: z.string().min(1),
      blockCount: z.number().int().nonnegative(),
      retrievedCandidates: z.number().int().nonnegative(),
      selectedItems: z.number().int().nonnegative(),
      droppedBlocks: z.number().int().nonnegative(),
      status: z.string().min(1),
      /** Safe path previews for UI — never full file contents. */
      paths: z.array(z.string().min(1).max(512)).max(12).optional(),
      retrievalSources: z
        .array(
          z
            .object({
              sourceId: z.string().min(1).max(64),
              status: z.string().min(1).max(32),
              candidateCount: z.number().int().nonnegative(),
            })
            .strict(),
        )
        .max(8)
        .optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("model_delta"),
      runId: z.string().min(1),
      kind: z.enum(["content", "reasoning", "tool_call"]),
      /** Safe preview only — truncated content fragment. */
      preview: z.string().max(500).optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("model_turn"),
      runId: z.string().min(1),
      turnIndex: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      finishReason: z.string().min(1).optional(),
      truncated: z.boolean().optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_started"),
      runId: z.string().min(1),
      callId: z.string().min(1),
      toolName: z.string().min(1),
      summary: z.string().min(1).max(500).optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_completed"),
      runId: z.string().min(1),
      callId: z.string().min(1),
      toolName: z.string().min(1),
      status: z.string().min(1),
      summary: z.string().min(1).max(500).optional(),
      reasonCode: z.string().min(1).max(80).optional(),
      warnings: z.array(z.string().min(1).max(500)).max(5).optional(),
      outputPreview: z.string().max(1_000).optional(),
      durationMs: z.number().int().nonnegative().optional(),
      bytesProduced: z.number().int().nonnegative().optional(),
      truncated: z.boolean().optional(),
      redacted: z.boolean().optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("evidence_updated"),
      runId: z.string().min(1),
      evidence: runEvidenceSchema,
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("suspended"),
      runId: z.string().min(1),
      kind: z.enum(AGENT_SUSPENSION_KINDS),
      rationale: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("warning"),
      runId: z.string().min(1),
      message: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("verification_completed"),
      runId: z.string().min(1),
      status: verificationStatusSchema,
      reasonCodes: z.array(verificationReasonCodeSchema),
      checks: z
        .array(
          z
            .object({
              checkId: z.string().min(1),
              kind: verificationCheckKindSchema,
              outcome: verificationCheckOutcomeSchema,
              summary: z.string().min(1).max(500),
            })
            .strict(),
        )
        .max(20),
      diagnostics: z
        .array(
          z
            .object({
              path: z.string().min(1).max(512),
              severity: verificationDiagnosticSeveritySchema,
              message: z.string().min(1).max(500),
              startLine: z.number().int().positive().optional(),
              source: z.string().min(1).max(120).optional(),
              code: z.string().min(1).max(120).optional(),
            })
            .strict(),
        )
        .max(20),
      warnings: z.array(z.string().min(1).max(500)).max(20),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("repo_build_state_captured"),
      runId: z.string().min(1),
      phase: z.enum(["before", "after"]),
      errorCount: z.number().int().nonnegative(),
      warningCount: z.number().int().nonnegative(),
      failedCheckIds: z.array(z.string().min(1).max(160)).max(16),
      projectIds: z.array(z.string().min(1).max(160)).max(16),
      durationMs: z.number().int().nonnegative().optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("verification_comparison"),
      runId: z.string().min(1),
      beforeErrorCount: z.number().int().nonnegative(),
      afterErrorCount: z.number().int().nonnegative(),
      clearedErrorCount: z.number().int().nonnegative(),
      newErrorCount: z.number().int().nonnegative(),
      remainingErrorCount: z.number().int().nonnegative(),
      failedCheckIdsAfter: z.array(z.string().min(1).max(160)).max(16),
      reasonCodes: z.array(z.string().min(1).max(80)).max(16),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("verification_record_saved"),
      runId: z.string().min(1),
      recordId: z.string().min(1),
      status: z.string().min(1).max(80),
      retryAvailable: z.boolean(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("verification_summary_ready"),
      runId: z.string().min(1),
      summaryChars: z.number().int().nonnegative(),
      newErrorCount: z.number().int().nonnegative().optional(),
      remainingErrorCount: z.number().int().nonnegative().optional(),
      clearedErrorCount: z.number().int().nonnegative().optional(),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("verification_retry_available"),
      runId: z.string().min(1),
      recordId: z.string().min(1),
      at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal("terminal"),
      runId: z.string().min(1),
      status: z.enum(AGENT_RUN_STATUSES),
      result: agentRunResultSchema,
      at: z.string().datetime(),
    })
    .strict(),
]);

export type RunEvent = z.infer<typeof runEventSchema>;
export type AgentActiveStage = z.infer<typeof agentActiveStageSchema>;
