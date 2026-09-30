import type { SkillsSelectResult } from "../../../modules/skills";
import type { RunEvent } from "../contracts";

export function buildSkillsReadyEvent(params: {
  runId: string;
  skillsResult: SkillsSelectResult;
  at: string;
}): Extract<RunEvent, { type: "skills_ready" }> {
  const { skillsResult, runId, at } = params;
  const selected = skillsResult.instructions
    .map((block) => block.id)
    .filter((id) => id.trim().length > 0)
    .slice(0, 20);

  return {
    type: "skills_ready",
    runId,
    selectedCount: skillsResult.instructions.length,
    omittedCount: skillsResult.omissions.length,
    requiredCount: skillsResult.requiredCount ?? 0,
    matchedCount: skillsResult.matchedCount ?? 0,
    status: skillsResult.status,
    selected,
    required: (skillsResult.required ?? []).slice(0, 20),
    omitted: skillsResult.omissions
      .map((omission) => omission.skillId)
      .filter((id) => id.trim().length > 0)
      .slice(0, 20),
    omittedDetails: skillsResult.omissions
      .map((omission) => ({
        id: omission.skillId,
        reason: omission.reason,
        ...(typeof omission.tokens === "number"
          ? { tokens: omission.tokens }
          : {}),
      }))
      .slice(0, 20),
    at,
  };
}
