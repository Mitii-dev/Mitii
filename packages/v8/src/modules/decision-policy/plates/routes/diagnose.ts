import type { DecisionPlate } from "../types";

export const diagnosePlate: DecisionPlate = {
  id: "diagnose_readonly",
  route: "diagnose",
  grantProfile: "research",
  planningDepth: "none",
  planGate: "none",
  reasonCodes: ["plate_diagnose"],
};
