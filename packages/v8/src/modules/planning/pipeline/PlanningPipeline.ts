import { compactPlan, draftPlan, validatePlan } from "../actions";
import { PLANNING_SCHEMA_VERSION } from "../constants";
import {
  PlanningError,
  planningInputSchema,
  planningResultSchema,
} from "../contracts";
import type {
  PlanningInput,
  PlanningReasonCode,
  PlanningResult,
} from "../contracts";
import type { z } from "zod";

/**
 * Planning facade.
 *
 * Flow:
 *   validate input
 *   → if planningDepth is none, return blocked/empty guidance
 *   → draft generic PlanArtifact from dimensions (+ optional skills/hints)
 *   → validate required sections
 *   → compact to budget
 *   → return planning result
 *
 * Does not execute tools or own run state. Engine decides when to call this
 * and whether to suspend for plan approval.
 */
export class PlanningPipeline {
  public plan(input: PlanningInput): PlanningResult {
    const startedMs = Date.now();

    let parsed: z.infer<typeof planningInputSchema>;
    try {
      parsed = planningInputSchema.parse(input);
    } catch (error) {
      throw new PlanningError(
        "invalid_input",
        "Planning input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    if (parsed.planningDepth === "none") {
      return planningResultSchema.parse({
        schemaVersion: PLANNING_SCHEMA_VERSION,
        status: "blocked",
        warnings: [],
        reasonCodes: ["plan_depth_none"],
        usedTokens: 0,
        budgetTokens: parsed.budgetTokens,
        durationMs: Date.now() - startedMs,
      });
    }

    const drafted = draftPlan(parsed);
    const validated = validatePlan({ plan: drafted, input: parsed });
    if (!validated.ok) {
      return planningResultSchema.parse({
        schemaVersion: PLANNING_SCHEMA_VERSION,
        status: "blocked",
        warnings: validated.warnings,
        reasonCodes: unique(validated.reasonCodes),
        usedTokens: 0,
        budgetTokens: parsed.budgetTokens,
        durationMs: Date.now() - startedMs,
      });
    }

    const compacted = compactPlan({
      plan: validated.plan,
      budgetTokens: parsed.budgetTokens,
    });

    const reasonCodes = unique([
      "plan_drafted",
      ...validated.reasonCodes,
      ...compacted.reasonCodes,
    ]);

    const status = compacted.compacted ? "compacted" : "validated";

    return planningResultSchema.parse({
      schemaVersion: PLANNING_SCHEMA_VERSION,
      status,
      plan: compacted.plan,
      warnings: validated.warnings,
      reasonCodes,
      usedTokens: compacted.usedTokens,
      budgetTokens: parsed.budgetTokens,
      durationMs: Date.now() - startedMs,
    });
  }
}

export {
  formatPlanAsAnswer,
  serializePlanForPrompt,
  serializePlanText,
} from "../actions";

function unique(codes: readonly PlanningReasonCode[]): PlanningReasonCode[] {
  return [...new Set(codes)];
}
