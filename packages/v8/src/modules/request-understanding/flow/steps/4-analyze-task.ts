import type { UserRequestEnvelope } from "../../../request-intake";
import type { UnderstandingEvidencePack } from "../../helpers/intent/evidence";
import type { SuperIntentResult } from "../../helpers/intent/types";
import type { TaskAnalyzer } from "../../helpers/task-analyzer/TaskAnalyzer";
import type { TaskAnalysis } from "../../helpers/task-analyzer/contracts/output/TaskAnalysis";
import type { RequestUnderstandingOptions } from "../types";

export function analyzeUnderstandingTask(params: {
  envelope: UserRequestEnvelope;
  userMessage: string;
  analysisMessage: string;
  intent: SuperIntentResult;
  evidence: UnderstandingEvidencePack;
  options: RequestUnderstandingOptions;
  taskAnalyzer: TaskAnalyzer;
}): TaskAnalysis {
  const {
    envelope,
    userMessage,
    analysisMessage,
    intent,
    evidence,
    options,
    taskAnalyzer,
  } = params;

  return taskAnalyzer.analyze({
    userMessage: analysisMessage || userMessage,
    intent,
    referencedArtifacts: envelope.referencedArtifacts.map((artifact) => ({
      name: artifact.name,
      path: artifact.path,
      kind: artifact.kind,
      extension: artifact.extension,
      language: artifact.language,
    })),
    turnKind: envelope.turnKind,
    sizeDraft: evidence.sizeDraft,
    ...(options.candidateRelativePaths &&
    options.candidateRelativePaths.length > 0
      ? { candidateRelativePaths: [...options.candidateRelativePaths] }
      : {}),
  });
}
