import { z } from "zod";

import { TaskAnalysisSchema } from "../../task-analyzer/contracts/output/TaskAnalysis";
import { superIntentResultSchema } from "../../task-analyzer/contracts/input/TaskAnalyzerInput";
import { understandingEvidencePackSchema } from "../../intent/evidence/UnderstandingEvidencePack";

export const requestUnderstandingResultSchema = z.object({
  intent: superIntentResultSchema,
  taskAnalysis: TaskAnalysisSchema,
  /** Audit mirror of investigator evidence shown to the Officer LLM. */
  evidence: understandingEvidencePackSchema.optional(),
});

export type RequestUnderstandingResult = z.infer<
  typeof requestUnderstandingResultSchema
>;
