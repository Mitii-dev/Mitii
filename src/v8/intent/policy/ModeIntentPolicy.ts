import { ThunderSession } from "../../../features/ce/session";
import type { IntentClassification, InteractionIntent } from "../schema";

/** Refer ModePolicy.md for more information. **/
export class ModeIntentPolicy {
  apply(
    mode: ThunderSession["mode"],
    classification: IntentClassification,
  ): IntentClassification {
    const interactionIntent = this.resolveInteractionIntent(
      mode,
      classification.interactionIntent,
    );

    if (interactionIntent === classification.interactionIntent) {
      return classification;
    }

    return {
      ...classification,
      interactionIntent,
      reason: this.buildReason(mode, classification),
    };
  }

  private resolveInteractionIntent(
    mode: ThunderSession["mode"],
    classifiedInteraction: InteractionIntent,
  ): InteractionIntent {
    switch (mode) {
      case "ask":
      case "review":
        return "question";

      case "plan":
        return "plan";

      case "agent":
        return "act";
      default:
        // Fallback to the classified interaction for any unknown/unsupported mode
        return classifiedInteraction;
    }
  }

  private buildReason(
    mode: ThunderSession["mode"],
    classification: IntentClassification,
  ): string {
    const originalReason = classification.reason?.trim();
    let policyReason = "";

    switch (mode) {
      case "ask":
      case "review":
        policyReason =
          "Ask/Review mode constrains the interaction to read-only question behavior.";
        break;
      case "plan":
        policyReason =
          "Plan mode constrains the interaction to planning behavior.";
        break;
      case "agent":
        policyReason = "Agent mode defaults to action execution.";
        break;
      default:
        policyReason = `Mode policy override applied for mode: ${mode}.`;
    }

    return originalReason ? `${originalReason} ${policyReason}` : policyReason;
  }
}
