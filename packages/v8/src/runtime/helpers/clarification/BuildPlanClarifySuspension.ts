import type { PlanClarifyDraft } from "../../../modules/planning";
import { formatClarifyAsAnswer } from "../../../modules/planning";
import { parseClarificationOptionId } from "../../../modules/request-understanding";

import type {
  ClarificationOptionPayload,
  ClarificationSession,
  ClarificationSessionOption,
} from "./ClarificationTypes";

/**
 * Build Plan-mode clarify suspension: findings answer + A/B/C chip options.
 */
export function buildPlanClarifySuspension(draft: PlanClarifyDraft): {
  answer: string;
  clarificationPrompt: string;
  clarificationOptions: ClarificationOptionPayload[];
  clarificationSession: ClarificationSession;
} {
  const answer = formatClarifyAsAnswer(draft);
  const sessionOptions: ClarificationSessionOption[] = [
    ...draft.scopeOptions,
    ...(draft.deliveryOptions ?? []),
  ]
    .slice(0, 8)
    .map((option) => {
      const id = option.id.startsWith("outcome:")
        ? option.id
        : `outcome:${option.id}`;
      return {
        id,
        label: option.label,
        description: option.detail,
        patch: {
          ...parseClarificationOptionId(id, option.label),
          outcomeNote: [option.label, option.detail].filter(Boolean).join(" — "),
        },
      };
    });

  const clarificationPrompt =
    answer.length <= 2_000
      ? answer
      : `${answer.slice(0, 1_900)}\n…\nChoose a scope (and delivery) option to continue.`;

  return {
    answer,
    clarificationPrompt,
    clarificationOptions: sessionOptions.map((option) => ({
      id: option.id,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
    })),
    clarificationSession: {
      question: "Choose plan scope (and optionally first delivery) before I lock Change steps.",
      slotKind: "intent",
      options: sessionOptions,
    },
  };
}
