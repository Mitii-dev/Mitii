import {
  modelRequestSchema,
  type LlmPort,
  type ModelRequest,
} from "../../model-gateway";
import type {
  DiscoveryBrief,
  PlanClarifyDraft,
  PlanningParsedInput,
} from "../contracts";
import { planClarifyDraftSchema } from "../contracts";
import {
  CLARIFY_PLAN_SYSTEM,
  renderClarifyPlanUserPrompt,
} from "../internal/clarifyPlanPrompt";
import {
  collectCompletionText,
  parseLastJsonObject,
} from "../internal/modelJson";
import { askNeedsPlanScopeFork } from "../internal/askNeedsPlanScopeFork";
import { PLAN_SCOPE_DEFS, PLAN_SCOPE_ORDER } from "../internal/planScopeChoice";

export type DraftClarifyFromDiscoveryResult =
  | { ok: true; draft: PlanClarifyDraft; source: "model" | "fallback" }
  | { ok: false; warning: string; draft: PlanClarifyDraft };

/**
 * One model call for Plan clarify: findings + scope forks from discovery.
 * Always returns a usable draft (deterministic fallback on failure).
 */
export async function draftClarifyFromDiscovery(params: {
  input: PlanningParsedInput;
  discoveryBrief?: DiscoveryBrief;
  llm?: LlmPort;
}): Promise<DraftClarifyFromDiscoveryResult> {
  const fallback = buildFallbackClarifyDraft(
    params.input,
    params.discoveryBrief,
  );
  if (!params.llm) {
    return { ok: true, draft: fallback, source: "fallback" };
  }
  try {
    const useStructured =
      params.llm.capabilities.supportsStructuredOutput === true;
    const request = modelRequestSchema.parse({
      messages: [
        { role: "system", content: CLARIFY_PLAN_SYSTEM },
        {
          role: "user",
          content: renderClarifyPlanUserPrompt({
            input: params.input,
            discoveryBrief: params.discoveryBrief,
          }),
        },
      ],
      temperature: 0,
      maximumOutputTokens: 1_200,
      stream: false,
      toolChoice: "none",
      reasoning: {
        enabled: false,
        effort: "low",
        includeInResponse: false,
      },
      ...(useStructured
        ? {
            responseFormat: {
              type: "json_schema" as const,
              name: "plan_clarify_draft",
              schema: CLARIFY_PLAN_JSON_SCHEMA,
              strict: true,
            },
          }
        : {}),
    }) as ModelRequest;
    const text = await collectCompletionText({
      llm: params.llm,
      request,
    });
    const raw = parseLastJsonObject(text);
    const parsed = planClarifyDraftSchema.parse({
      schemaVersion: 1,
      ...(raw && typeof raw === "object" ? raw : {}),
    });
    return { ok: true, draft: parsed, source: "model" };
  } catch (error) {
    return {
      ok: false,
      warning: `Clarify draft model call failed; used deterministic scope forks. ${
        error instanceof Error ? error.message : String(error)
      }`,
      draft: fallback,
    };
  }
}

export function buildFallbackClarifyDraft(
  input: PlanningParsedInput,
  discoveryBrief?: DiscoveryBrief,
): PlanClarifyDraft {
  const findings = buildFallbackFindings(input, discoveryBrief);
  return planClarifyDraftSchema.parse({
    schemaVersion: 1,
    findings,
    scopeOptions: PLAN_SCOPE_ORDER.map((id) => {
      const def = PLAN_SCOPE_DEFS[id];
      return {
        id: def.optionId,
        label: `${def.letter}) ${def.label}`,
        detail: def.detail,
      };
    }),
    deliveryOptions: [
      {
        id: "outcome:delivery-quick-wins",
        label: "Quick wins",
        detail: "Fix brittle oracles and expand contracts on high-value cases first.",
      },
      {
        id: "outcome:delivery-quality-gate",
        label: "Quality gate",
        detail:
          "Make validate/CI fail on missing solution/oracle and dry-run more than smoke.",
      },
      {
        id: "outcome:delivery-architecture",
        label: "Architecture",
        detail: "Redesign grading layers/weights, DSL gaps, or project suites first.",
      },
    ],
    replyHint: "Reply A, B, or C (optionally + delivery), then I write the plan.",
  });
}

function buildFallbackFindings(
  input: PlanningParsedInput,
  discoveryBrief?: DiscoveryBrief,
): string[] {
  const findings: string[] = [];
  const files = discoveryBrief?.filesRead ?? [];
  if (files.length > 0) {
    findings.push(
      `Reviewed ${files.length} file(s); no single change surface locked yet.`,
    );
  } else {
    findings.push("Not enough file evidence yet for a concrete Change plan.");
  }
  // Only claim a scope fork when the ask language actually forks — empty
  // discovery surfaces alone are not an A/B/C decision.
  if (
    askNeedsPlanScopeFork({
      clarity: input.evidence.clarity,
      primaryIntent: input.evidence.primaryIntent,
      requestedOutcomes: input.evidence.requestedOutcomes,
      query: input.query,
    })
  ) {
    findings.push(
      "Ask forks across scopes — pick A/B/C before Change steps.",
    );
  } else if ((discoveryBrief?.proposedChangeSurfaces.length ?? 0) === 0) {
    findings.push(
      "Need a concrete change surface before locking Change steps.",
    );
  }
  return findings.slice(0, 2);
}

const CLARIFY_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "scopeOptions"],
  properties: {
    findings: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: { type: "string", minLength: 1, maxLength: 160 },
    },
    scopeOptions: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          label: { type: "string", minLength: 1, maxLength: 200 },
          detail: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
    deliveryOptions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          label: { type: "string", minLength: 1, maxLength: 200 },
          detail: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
    replyHint: { type: "string", minLength: 1, maxLength: 300 },
  },
} as const;
