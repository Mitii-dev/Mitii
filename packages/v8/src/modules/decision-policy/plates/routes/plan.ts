import type { DecisionPlate } from "../types";

export const planVisiblePlate: DecisionPlate = {
  id: "plan_visible_readonly",
  route: "plan",
  grantProfile: "research",
  planningDepth: "visible",
  planGate: "none",
  reasonCodes: ["plate_plan_visible"],
};
