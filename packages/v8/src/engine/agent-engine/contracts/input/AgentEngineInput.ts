import { z } from "zod";

import { createUserRequestInputSchema } from "../../../../modules/request-intake";
import {
  APPROVAL_MODES,
  repositoryStateCapabilitySummarySchema,
} from "../../../../modules/decision-policy";
import {
  modelMessageSchema,
  modelToolDefinitionSchema,
} from "../../../../modules/model-gateway";
import {
  explorationDepthSchema,
  planArtifactSchema,
  planStrategyDecisionSchema,
} from "../../../../modules/planning";
import { taskListSchema } from "../../../../modules/task-list";
import { promptInstructionsSchema } from "../../../../modules/prompt-construction";
import { projectDescriptorSchema } from "../../../../modules/repository-state";
import { windowBudgetPolicyOverridesSchema } from "../../../../modules/window-budget";
import { WINDOW_BUDGET_EFFORTS } from "../../../../modules/window-budget";

import {
  AGENT_ENGINE_SCHEMA_VERSION,
  AGENT_LOG_VERBOSITIES,
  DEFAULT_AGENT_LOG_VERBOSITY,
} from "../../constants";
import {
  DEFAULT_MAX_LOOP_ITERATIONS,
  DEFAULT_MAX_MODEL_CALLS,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_MAX_WALL_TIME_MS,
} from "../../defaults";
import { agentEngineThresholdsOverridesSchema } from "../../actions/resolveAgentEngineThresholds";

const agentApprovalModeSchema = z.enum(APPROVAL_MODES);

export const agentRunBudgetSchema = z
  .object({
    /**
     * When true, host run-budget numbers are used as-is.
     * Window-derived ceilings do not clamp an explicit unlimited request.
     */
    unlimited: z.boolean().default(false),
    maxModelCalls: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_MODEL_CALLS),
    maxToolCalls: z.number().int().positive().default(DEFAULT_MAX_TOOL_CALLS),
    maxLoopIterations: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_LOOP_ITERATIONS),
    maxWallTimeMs: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_WALL_TIME_MS),
  })
  .strict();

export type AgentRunBudget = z.infer<typeof agentRunBudgetSchema>;

/**
 * Boundary input for starting an agent run.
 *
 * Hosts supply the raw request plus optional pinned/known repository state.
 * Engine pins state when Decision Policy requires repository context.
 * Optional dirtyPaths list user-dirty files for overlap checks.
 */
export const agentEngineStartInputSchema = z
  .object({
    schemaVersion: z.literal(AGENT_ENGINE_SCHEMA_VERSION),
    request: createUserRequestInputSchema,
    /** Absolute workspace root required when tools may execute. */
    workspaceRoot: z.string().min(1).optional(),
    repositoryState: repositoryStateCapabilitySummarySchema.optional(),
    /**
     * Optional project catalog for Verification language discovery.
     * When omitted, Engine synthesizes a single root project.
     */
    projects: z.array(projectDescriptorSchema).optional(),
    conversation: z.array(modelMessageSchema).default([]),
    instructions: promptInstructionsSchema.optional(),
    /**
     * Host-carried plan from a prior plan-mode (or equivalent) turn.
     * When set, Engine treats it as already approved: injects it into the
     * system prompt and skips the plan-approval gate for this start.
     */
    approvedPlan: planArtifactSchema.optional(),
    /**
     * Strategy for a host-carried approved plan. When omitted, Engine infers
     * a conservative strategy from the artifact shape.
     */
    approvedPlanStrategy: planStrategyDecisionSchema.optional(),
    /**
     * Host-carried live task list from a prior turn.
     * Engine does not stamp remaining items done when the run finishes.
     */
    taskList: taskListSchema.optional(),
    /** Optional override; otherwise Engine uses default tool definitions. */
    tools: z.array(modelToolDefinitionSchema).optional(),
    budget: agentRunBudgetSchema.optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    approvalMode: agentApprovalModeSchema.optional(),
    planApproval: z.enum(["policy", "never"]).optional(),
    /**
     * Workspace-relative paths dirty before the run (user edits).
     * Used for dirty-overlap rejection on mutation tools.
     */
    dirtyPaths: z.array(z.string().min(1)).optional(),
    /**
     * How hard Engine should look before drafting a plan. Orthogonal to
     * Decision Policy's planningDepth (whether a visible plan exists at
     * all) — this is the look-budget knob; "auto" defers to strategy rules.
     */
    explorationDepth: explorationDepthSchema.default("auto"),
    /**
     * Optional host overrides for window-proportional token allocation.
     * When omitted, Window Budget defaults apply.
     */
    windowBudget: z
      .object({
        policy: windowBudgetPolicyOverridesSchema.optional(),
        effort: z.enum(WINDOW_BUDGET_EFFORTS).optional(),
      })
      .strict()
      .optional(),
    /**
     * Optional host lab overrides for Agent Engine loop/stall thresholds.
     * Merged after the shipped window band selected from the effective
     * context window. When omitted, band standards alone apply.
     * Edit permanent band values in `policy/loopPolicyBands.ts`.
     */
    loopPolicy: z
      .object({
        thresholds: agentEngineThresholdsOverridesSchema.optional(),
      })
      .strict()
      .optional(),
    /**
     * Developer-facing diagnostic detail level for this run's RunEvent
     * stream. See AGENT_LOG_VERBOSITIES. Defaults to "verbose" so bugs are
     * discoverable; hosts can turn this down when log volume matters more
     * than diagnostic depth.
     */
    logVerbosity: z.enum(AGENT_LOG_VERBOSITIES).default(DEFAULT_AGENT_LOG_VERBOSITY),
  })
  .strict();

export type AgentEngineStartInput = z.infer<typeof agentEngineStartInputSchema>;

/**
 * Resume a suspended run after clarification, mutation approval, or plan approval.
 * Resume continues from the persisted checkpoint and does not replay
 * completed tool callIds.
 */
export const agentEngineResumeInputSchema = z
  .object({
    schemaVersion: z.literal(AGENT_ENGINE_SCHEMA_VERSION),
    runId: z.string().min(1),
    approval: z
      .object({
        approvalId: z.string().min(1),
        decision: z.enum(["approved", "denied"]),
      })
      .strict()
      .optional(),
    /**
     * Optional host override captured at resume time. This lets a permission
     * change made while a run is suspended apply to later tool calls in the
     * same run.
     */
    approvalMode: agentApprovalModeSchema.optional(),
    clarificationAnswer: z.string().min(1).optional(),
    planDecision: z
      .object({
        decision: z.enum(["approved", "rejected", "edited"]),
        /** Required when decision is "edited"; optional override when approved. */
        plan: planArtifactSchema.optional(),
      })
      .strict()
      .optional(),
    grantExpansion: z
      .object({
        expansionId: z.string().min(1),
        decision: z.enum(["approved", "denied"]),
      })
      .strict()
      .optional(),
    continueDecision: z
      .object({
        decision: z.enum(["continue", "stop"]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const provided = [
      value.approval,
      value.clarificationAnswer,
      value.planDecision,
      value.grantExpansion,
      value.continueDecision,
    ].filter((item) => item !== undefined);
    if (provided.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Resume requires approval, clarificationAnswer, planDecision, grantExpansion, or continueDecision.",
      });
    }
    if (
      value.planDecision?.decision === "edited" &&
      value.planDecision.plan === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Edited planDecision requires plan.",
        path: ["planDecision", "plan"],
      });
    }
  });

export type AgentEngineResumeInput = z.infer<
  typeof agentEngineResumeInputSchema
>;
