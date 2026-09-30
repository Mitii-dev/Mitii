import type { RequestTurnKind } from "../../../request-intake";
import type { IntentClassification } from "../schema";

const CONTINUATION_TURN_KINDS: ReadonlySet<RequestTurnKind> = new Set([
  "continue",
  "steer",
  "follow_up",
  "recover",
]);

/**
 * Soften clarification on continuation turns.
 * Mid-run steer / follow-up is rarely a fresh ambiguous ask — prefer acting
 * on the latest instruction unless the host already cleared facts.
 */
export class TurnKindIntentPolicy {
  apply(
    turnKind: RequestTurnKind | undefined,
    classification: IntentClassification,
  ): IntentClassification {
    if (!turnKind || turnKind === "new") {
      return classification;
    }
    if (!CONTINUATION_TURN_KINDS.has(turnKind)) {
      return classification;
    }
    if (!classification.needsClarification) {
      return classification;
    }

    const reason = classification.reason?.trim();
    const policyReason =
      `Turn kind "${turnKind}" continues an in-flight request; ` +
      "clarification is deferred unless the host re-asks.";

    return {
      ...classification,
      needsClarification: false,
      reason: reason ? `${reason} ${policyReason}` : policyReason,
    };
  }
}

export function isContinuationTurnKind(
  turnKind: RequestTurnKind | undefined,
): boolean {
  return turnKind !== undefined && CONTINUATION_TURN_KINDS.has(turnKind);
}
