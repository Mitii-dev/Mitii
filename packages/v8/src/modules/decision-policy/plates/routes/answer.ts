import type { DecisionPlate } from "../types";

/** Merged answer route — wire route stays repository_answer until ExecutionRoute adds `answer`. */
export const answerResearchPlate: DecisionPlate = {
  id: "answer_research",
  route: "answer",
  grantProfile: "research",
  planningDepth: "none",
  planGate: "none",
  reasonCodes: ["plate_answer_research"],
};
