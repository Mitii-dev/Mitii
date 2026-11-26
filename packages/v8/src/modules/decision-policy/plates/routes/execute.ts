import type { DecisionPlate } from "../types";

export const executeMutatePlate: DecisionPlate = {
  id: "execute_mutate",
  route: "execute",
  grantProfile: "agent_execute",
  planningDepth: "internal",
  planGate: "none",
  reasonCodes: ["plate_execute_mutate"],
};

export const executeVisiblePlate: DecisionPlate = {
  id: "execute_visible",
  route: "execute",
  grantProfile: "agent_execute",
  planningDepth: "visible",
  planGate: "required_before_execute",
  reasonCodes: ["plate_execute_visible"],
};

export const executeFastPathPlate: DecisionPlate = {
  id: "execute_fast_path",
  route: "execute",
  grantProfile: "agent_execute",
  planningDepth: "none",
  planGate: "none",
  reasonCodes: ["plate_execute_fast_path"],
};
