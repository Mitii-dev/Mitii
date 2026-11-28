import { requestUnderstandingResultSchema } from "../../contracts";
import type { RequestUnderstandingResult } from "../../contracts";
import type { UnderstandingEvidencePack } from "../../helpers/intent/evidence";
import type { SuperIntentResult } from "../../helpers/intent/types";
import type { TaskAnalysis } from "../../helpers/task-analyzer/contracts/output/TaskAnalysis";

export function finalizeUnderstandingResult(params: {
  intent: SuperIntentResult;
  taskAnalysis: TaskAnalysis;
  evidence: UnderstandingEvidencePack;
}): RequestUnderstandingResult {
  return requestUnderstandingResultSchema.parse({
    intent: params.intent,
    taskAnalysis: params.taskAnalysis,
    evidence: params.evidence,
  });
}
