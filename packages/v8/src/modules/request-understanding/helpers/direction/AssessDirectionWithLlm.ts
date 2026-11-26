import {
  directionAnalysisInputSchema,
  type DirectionAnalysisInput,
} from "../../contracts/input/DirectionAnalysisInput";
import {
  taskDirectionAssessmentSchema,
  type TaskDirectionAssessment,
} from "../../contracts/output/TaskDirectionAssessment";
import { assessDirection as assessDirectionDeterministic } from "./AssessDirection";

/** Minimal complete hook — hosts/runtime adapt their model port to this. */
export type DirectionLlmComplete = (input: {
  system: string;
  user: string;
}) => Promise<string>;

const SYSTEM = `You are the Mitii direction Officer. Return ONLY JSON for a TaskDirectionAssessment ballot.
Decision Policy owns route/grant — you only assess.
Required keys: schemaVersion(1), primaryTaskIntent, interactionIntent, difficulty, taskBand, risk, scope, planningHint, clarityConfidence, askUserSuggested, filesToRead, reasonCodes.
primaryTaskIntent one of: bugfix,feature,refactor,optimize,diagnose,test,audit,review,security,trace,scaffold,migrate,schema,mock,config,dependency,docs,style,format,question,unclear
planningHint: none|short|medium|long
Do not invent mutation fences. Prefer assumptionsMade over askUserSuggested when the ask is clear.`;

function buildUserPrompt(input: DirectionAnalysisInput): string {
  return [
    `<user_command trust="untrusted-data">${input.userCommand}</user_command>`,
    `<mode>${input.mode}</mode>`,
    `<turn_kind>${input.turnKind}</turn_kind>`,
    `<situation_summary>${JSON.stringify(input.situationSummary)}</situation_summary>`,
    input.intentCues
      ? `<intent_cues>${JSON.stringify(input.intentCues)}</intent_cues>`
      : "",
    input.attachedSkills.length
      ? `<skills>${JSON.stringify(input.attachedSkills)}</skills>`
      : "",
    input.attachedMcp.length
      ? `<mcp>${JSON.stringify(input.attachedMcp)}</mcp>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1]?.trim() ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no_json_object");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * LLM-first direction ballot with deterministic fallback (S2-NO-HEURISTICS path).
 * Without `complete`, uses deterministic assess only.
 */
export async function assessDirectionWithLlm(
  raw: DirectionAnalysisInput,
  complete?: DirectionLlmComplete,
): Promise<TaskDirectionAssessment> {
  const input = directionAnalysisInputSchema.parse(raw);
  if (!complete) {
    return assessDirectionDeterministic(input);
  }

  try {
    const text = await complete({
      system: SYSTEM,
      user: buildUserPrompt(input),
    });
    const parsed = extractJsonObject(text);
    const ballot = taskDirectionAssessmentSchema.parse({
      ...(typeof parsed === "object" && parsed !== null ? parsed : {}),
      schemaVersion: 1,
      reasonCodes: [
        "assess_direction_llm",
        ...((parsed as { reasonCodes?: string[] })?.reasonCodes ?? []),
      ],
    });
    return ballot;
  } catch {
    const fallback = assessDirectionDeterministic(input);
    return taskDirectionAssessmentSchema.parse({
      ...fallback,
      reasonCodes: [
        ...fallback.reasonCodes,
        "assess_llm_fallback_deterministic",
      ],
    });
  }
}
