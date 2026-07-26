import { z } from "zod";

import { TaskAnalysisSchema } from "../../task-analyzer/contracts/output/TaskAnalysis";
import { superIntentResultSchema } from "../../task-analyzer/contracts/input/TaskAnalyzerInput";

export const requestUnderstandingResultSchema = z.object({
  intent: superIntentResultSchema,
  taskAnalysis: TaskAnalysisSchema,
});

export type RequestUnderstandingResult = z.infer<
  typeof requestUnderstandingResultSchema
>;
