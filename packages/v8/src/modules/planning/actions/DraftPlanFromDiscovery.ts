import {
  modelRequestSchema,
  type LlmPort,
  type ModelRequest,
} from "../../model-gateway";
import type {
  DiscoveredPlanDraft,
  DiscoveryBrief,
  PlanningParsedInput,
} from "../contracts";
import { discoveredPlanDraftSchema } from "../contracts";
import {
  DISCOVERED_PLAN_SYSTEM,
  renderDiscoveredPlanUserPrompt,
} from "../internal/discoveredPlanPrompt";
import {
  collectCompletionText,
  parseLastJsonObject,
} from "../internal/modelJson";
import { DISCOVERED_PLAN_POLICY } from "../policy";

export type DraftPlanFromDiscoveryResult =
  | { ok: true; draft: DiscoveredPlanDraft }
  | { ok: false; warning: string };

/**
 * The single model call for `discover_and_plan`: turn already-gathered
 * discovery evidence into Change+Verify steps. Runs at most once per plan —
 * this is not a generic enrichment layer, it is strategy-specific drafting.
 */
export async function draftPlanFromDiscovery(params: {
  input: PlanningParsedInput;
  discoveryBrief: DiscoveryBrief;
  llm: LlmPort;
}): Promise<DraftPlanFromDiscoveryResult> {
  try {
    const request = modelRequestSchema.parse({
      messages: [
        { role: "system", content: DISCOVERED_PLAN_SYSTEM },
        {
          role: "user",
          content: renderDiscoveredPlanUserPrompt({
            input: params.input,
            discoveryBrief: params.discoveryBrief,
          }),
        },
      ],
      temperature: 0,
      maximumOutputTokens: 2_000,
      stream: false,
      toolChoice: "none",
      reasoning: {
        enabled: false,
        effort: "low",
        includeInResponse: false,
      },
      responseFormat: {
        type: "json_schema",
        name: "discovered_plan_draft",
        schema: DISCOVERED_PLAN_JSON_SCHEMA,
        strict: true,
      },
    }) as ModelRequest;
    const text = await collectCompletionText({ llm: params.llm, request });
    const parsed = discoveredPlanDraftSchema.parse(parseLastJsonObject(text));
    return {
      ok: true,
      draft: {
        ...parsed,
        steps: parsed.steps.slice(0, DISCOVERED_PLAN_POLICY.maxSteps),
      },
    };
  } catch (error) {
    return {
      ok: false,
      warning:
        error instanceof Error && error.message === "model_output_truncated"
          ? "Discovery plan draft model call was truncated; rejected the partial draft and kept the deterministic discovery skeleton."
          : `Discovery plan draft model call failed; kept deterministic discovery skeleton. ${
              error instanceof Error ? error.message : String(error)
            }`,
    };
  }
}

const DISCOVERED_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["steps"],
  properties: {
    objective: { type: "string", minLength: 1, maxLength: 1_000 },
    openQuestions: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    steps: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "phaseHint",
          "intent",
          "actionSummary",
          "targetRefs",
          "expectedOutcome",
        ],
        properties: {
          phaseHint: { enum: ["change", "verify"] },
          intent: { type: "string", minLength: 1, maxLength: 500 },
          actionSummary: { type: "string", minLength: 1, maxLength: 1_000 },
          targetRefs: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 500 },
          },
          expectedOutcome: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
  },
} as const;
