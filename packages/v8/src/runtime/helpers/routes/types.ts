/** Which pump stages a route body activates (§0.1 / §6.11). */
export interface RouteBodyPlan {
  route: string;
  grantProfileHint: string;
  runPlanPipeline: boolean;
  runEnrich: boolean;
  runTurnLoop: boolean;
  runVerify: boolean;
  /** complete | suspend_clarify | suspend_plan_gate */
  exit: "complete" | "suspend_clarify" | "suspend_plan_gate" | "continue_execute";
  reasonCodes: string[];
}
