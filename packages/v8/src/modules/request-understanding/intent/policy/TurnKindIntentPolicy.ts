import type { RequestTurnKind } from "../../../request-intake";
import type { IntentClassification } from "../schema";

const CONTINUATION_TURN_KINDS: ReadonlySet<RequestTurnKind> = new Set([
  "continue",
  "steer",
  "follow_up",
  "recover",
]);

/**
 * Short plan-approval phrases (Cline-style). On a continuation turn whose
 * ballot is still "plan", promote interaction to "act" so Decision Policy can
 * execute without inventing a new task intent.
 */
const PLAN_APPROVAL_PATTERN =
  /^(?:please\s+|ok(?:ay)?[.,!]?\s+|sure[.,!]?\s+)?(?:go\s+ahead|looks\s+good|lgtm|do\s+it|ship\s+it|approve(?:d)?|proceed|yes(?:\s+please)?|sounds\s+good)[.!]*$/i;

export interface TurnKindIntentPolicyOptions {
  /** Latest user message — used only for plan-approval phrase detection. */
  userMessage?: string;
}

/**
 * Soften clarification on continuation turns.
 * Mid-run steer / follow-up is rarely a fresh ambiguous ask — prefer acting
 * on the latest instruction unless the host already cleared facts.
 */
export class TurnKindIntentPolicy {
  apply(
    turnKind: RequestTurnKind | undefined,
    classification: IntentClassification,
    options: TurnKindIntentPolicyOptions = {},
  ): IntentClassification {
    if (!turnKind || turnKind === "new") {
      return classification;
    }
    if (!CONTINUATION_TURN_KINDS.has(turnKind)) {
      return classification;
    }

    let next = classification;
    let changed = false;

    if (classification.needsClarification) {
      const reason = classification.reason?.trim();
      const policyReason =
        `Turn kind "${turnKind}" continues an in-flight request; ` +
        "clarification is deferred unless the host re-asks.";

      next = {
        ...next,
        needsClarification: false,
        reason: reason ? `${reason} ${policyReason}` : policyReason,
      };
      changed = true;
    }

    const message = options.userMessage?.trim() ?? "";
    if (
      message.length > 0 &&
      message.length <= 80 &&
      next.interactionIntent === "plan" &&
      PLAN_APPROVAL_PATTERN.test(message)
    ) {
      const reason = next.reason?.trim();
      const policyReason =
        `Turn kind "${turnKind}" approved the prior plan; ` +
        "treating the request as act.";
      next = {
        ...next,
        interactionIntent: "act",
        reason: reason ? `${reason} ${policyReason}` : policyReason,
      };
      changed = true;
    }

    return changed ? next : classification;
  }
}

export function isContinuationTurnKind(
  turnKind: RequestTurnKind | undefined,
): boolean {
  return turnKind !== undefined && CONTINUATION_TURN_KINDS.has(turnKind);
}
