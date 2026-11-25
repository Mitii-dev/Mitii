import type { UserRequestEnvelope } from "../../../request-intake";
import {
  buildUnderstandingEvidencePack,
  type UnderstandingEvidencePack,
} from "../../helpers/intent/evidence";
import type { RulePrior } from "../../helpers/intent/types";
import type { RequestUnderstandingOptions } from "../types";

export function buildUnderstandingEvidence(params: {
  envelope: UserRequestEnvelope;
  userMessage: string;
  rulePriors: RulePrior[];
  options: RequestUnderstandingOptions;
}): UnderstandingEvidencePack {
  const { envelope, userMessage, rulePriors, options } = params;
  return buildUnderstandingEvidencePack({
    mode: envelope.mode,
    turnKind: envelope.turnKind,
    origin: envelope.origin,
    messageText: userMessage,
    originalMessageLength: envelope.message.length,
    referencedArtifacts: envelope.referencedArtifacts,
    attachments: envelope.attachments,
    rulePriors,
    diagnosticSummary: options.diagnosticSummary,
    requiredMcpServerIds: options.requiredMcpServerIds,
    historyDigest: options.historyDigest,
    priorRoute: options.priorRoute,
    priorTaskSize: options.priorTaskSize,
    projectFingerprint: options.projectFingerprint,
  });
}
