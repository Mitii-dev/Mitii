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
    scopeOptions: [
      {
        id: "outcome:scope-a-focused",
        label: "A) Focused case hardening",
        detail:
          "Harden high-value cases (oracles, negative paths, HTTP contracts) without redesigning the harness.",
      },
      {
        id: "outcome:scope-b-corpus",
        label: "B) Corpus-wide quality bar",
        detail:
          "Raise the bar across weak cases (solutions/oracles) and CI/validate coverage beyond smoke.",
      },
      {
        id: "outcome:scope-c-architecture",
        label: "C) Runner / architecture changes",
        detail:
          "Redesign grading DSL, scoring, dry-run policy, or workspace change rules.",
      },
    ],
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
    replyHint:
      "Reply with something like B + quality gate (or A + quick wins), and I will write a concrete phased plan against that.",
  });
}

function buildFallbackFindings(
  input: PlanningParsedInput,
  discoveryBrief?: DiscoveryBrief,
): string[] {
  const findings: string[] = [];
  const files = discoveryBrief?.filesRead ?? [];
  if (files.length > 0) {
    const sample = files
      .slice(0, 4)
      .map((file) => file.path)
      .join(", ");
    findings.push(
      `Discovery reviewed ${files.length} file(s) so far (including ${sample}) but did not lock a single change surface.`,
    );
  } else {
    findings.push(
      "Discovery did not gather enough file-backed evidence to lock a concrete Change plan.",
    );
  }
  if (
    input.evidence.clarity === "unclear" ||
    input.evidence.clarity === "partially_clear"
  ) {
    findings.push(
      "The ask forks across quality improvements and architecture — scope must be chosen before Change steps.",
    );
  } else {
    findings.push(
      "Multiple plausible scopes remain (focused cases vs corpus bar vs harness architecture).",
    );
  }
  if ((discoveryBrief?.proposedChangeSurfaces.length ?? 0) === 0) {
    findings.push(
      "No concrete proposed change surfaces survived the quality floor; inventing file work would be guesswork.",
    );
  }
  return findings.slice(0, 5);
}

const CLARIFY_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "scopeOptions"],
  properties: {
    findings: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 500 },
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
