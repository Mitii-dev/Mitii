import type { ResumePlan } from "../types";

export function resumeClarification(input: {
  clarifyOrigin?: string;
  hasPlanDraft?: boolean;
}): ResumePlan {
  const origin = input.clarifyOrigin;
  if (
    (origin === "scope_fork" || origin === "hollow_plan") &&
    input.hasPlanDraft
  ) {
    return { reenter: "after_plan", reasonCodes: ["resume_clarify_after_plan"] };
  }
  return { reenter: "decide", reasonCodes: ["resume_clarify_decide"] };
}
