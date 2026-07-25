import type {
  AgentMode,
} from "../../../request-intake";

import type { IntentClassification, InteractionIntent } from "../schema";

/** Refer ModePolicy.md for more information. **/
export class ModeIntentPolicy {
  apply(
    mode: AgentMode,
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
    mode: AgentMode,
    classifiedInteraction: InteractionIntent,
  ): InteractionIntent {
    switch (mode) {
      case "ask":
        return "question";

      case "plan":
        return "plan";

      case "agent":
        return classifiedInteraction;
    }
  }

  private buildReason(
    mode: AgentMode,
    classification: IntentClassification,
  ): string {
    const originalReason = classification.reason?.trim();
    let policyReason = "";

    switch (mode) {
      case "ask":
        policyReason =
          "Ask mode constrains the interaction to read-only question behavior.";
        break;
      case "plan":
        policyReason =
          "Plan mode constrains the interaction to planning behavior.";
        break;
      case "agent":
        policyReason =
          "Agent mode permits execution without changing the classified interaction.";
    }

    return originalReason ? `${originalReason} ${policyReason}` : policyReason;
  }
}
