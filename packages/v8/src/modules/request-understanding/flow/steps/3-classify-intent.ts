import type { UserRequestEnvelope } from "../../../request-intake";
import type { IntentRouter } from "../../helpers/intent/IntentRouter";
import type { UnderstandingEvidencePack } from "../../helpers/intent/evidence";
import type { SuperIntentResult } from "../../helpers/intent/types";
import type { RequestUnderstandingOptions } from "../types";

export async function classifyUnderstandingIntent(params: {
  envelope: UserRequestEnvelope;
  userMessage: string;
  evidence: UnderstandingEvidencePack;
  options: RequestUnderstandingOptions;
  intentRouter: IntentRouter;
}): Promise<SuperIntentResult> {
  const { envelope, userMessage, evidence, options, intentRouter } = params;
  return intentRouter.classify({
    mode: envelope.mode,
    userMessage,
    referencedArtifacts: envelope.referencedArtifacts,
    diagnosticSummary: options.diagnosticSummary,
    turnKind: envelope.turnKind,
    evidence,
  });
}
