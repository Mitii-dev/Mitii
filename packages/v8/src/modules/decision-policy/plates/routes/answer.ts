import type { DecisionPlate } from "../types";

/** Merged answer route (ex direct_answer + repository_answer). */
export const answerResearchPlate: DecisionPlate = {
  id: "answer_research",
  route: "answer",
  grantProfile: "research",
  planningDepth: "none",
  planGate: "none",
  reasonCodes: ["plate_answer_research"],
};
