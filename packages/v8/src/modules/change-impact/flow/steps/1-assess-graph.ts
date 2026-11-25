import type {
  ChangeImpactParsedInput,
  ChangeImpactReasonCode,
  ChangeImpactWarningCode,
} from "../../contracts";
import { CHANGE_IMPACT_MESSAGES, CHANGE_IMPACT_REASON } from "../../constants";
import { computeGraphConfidence } from "../../helpers/computeGraphConfidence";
import type { GraphConfidenceAssessment } from "../../helpers/computeGraphConfidence";

export type AssessGraphResult = {
  confidence: GraphConfidenceAssessment;
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
  reasonCodes: ChangeImpactReasonCode[];
};

/**
 * Flow step 1: graph confidence + stale/partial signals before seed resolve.
 */
export function assessChangeImpactGraph(params: {
  input: ChangeImpactParsedInput;
}): AssessGraphResult {
  const graph = params.input.repoGraph;
  const warnings: Array<{
    code: ChangeImpactWarningCode;
    message: string;
  }> = [];
  const reasonCodes: ChangeImpactReasonCode[] = [];

  const confidence = computeGraphConfidence(graph);
  if (graph.status === "partial") {
    warnings.push({
      code: "graph_partial",
      message: CHANGE_IMPACT_MESSAGES.graphPartial,
    });
  }
  if (confidence.unsafe) {
    reasonCodes.push(CHANGE_IMPACT_REASON.graphConfidenceUnsafe);
    warnings.push({
      code: "graph_confidence_unsafe",
      message:
        confidence.note ?? CHANGE_IMPACT_MESSAGES.graphConfidenceUnsafe,
    });
  } else if (confidence.low) {
    warnings.push({
      code: "graph_confidence_low",
      message: confidence.note ?? CHANGE_IMPACT_MESSAGES.graphConfidenceLow,
    });
  }

  if (
    params.input.codeIndexChangeToken &&
    params.input.codeIndexChangeToken !== graph.codeIndexChangeToken
  ) {
    reasonCodes.push(CHANGE_IMPACT_REASON.graphStale);
  }

  return { confidence, warnings, reasonCodes };
}
