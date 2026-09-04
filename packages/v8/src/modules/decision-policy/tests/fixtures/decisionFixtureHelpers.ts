import type { AgentMode, UserRequestOrigin } from "../../../request-intake";
import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
  type WindowPolicy,
} from "../../../window-budget";
import type { RequestUnderstandingResult } from "../../../request-understanding";
import { DECISION_POLICY_SCHEMA_VERSION } from "../../constants";
import type { DecisionPolicyInput } from "../../contracts";

import { createUnderstanding } from "./decisionCases";
import type { GoldenDecisionCase } from "./decisionFixtureTypes";

export { createUnderstanding };

export function createTarget(
  value: string,
  kind: "file" | "folder" | "package" = "file",
): RequestUnderstandingResult["taskAnalysis"]["targets"][number] {
  return {
    kind,
    value,
    explicit: true,
  };
}

export function createWindowPolicy(options: {
  visiblePlanAffordable?: boolean;
  changeImpactAffordable?: boolean;
}): WindowPolicy {
  const visiblePlanAffordable = options.visiblePlanAffordable ?? true;
  const changeImpactAffordable = options.changeImpactAffordable ?? true;

  if (visiblePlanAffordable && changeImpactAffordable) {
    return deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 200_000,
    });
  }

  return deriveWindowPolicy({
    schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
    contextWindowTokens: 30_000,
    policy: {
      visiblePlanMinUsableTokens: visiblePlanAffordable ? 1_000 : 1_000_000,
      visiblePlanMinUsableRatio: visiblePlanAffordable ? 0 : 1,
      changeImpactMinUsableTokens: changeImpactAffordable ? 1_000 : 1_000_000,
      changeImpactMinUsableRatio: changeImpactAffordable ? 0 : 1,
    },
  });
}

export function createDecisionInput(
  fixture: Pick<
    GoldenDecisionCase,
    | "mode"
    | "message"
    | "understanding"
    | "repositoryState"
    | "approvalMode"
    | "planApproval"
    | "hostCapabilities"
    | "windowPolicy"
  > & { origin?: UserRequestOrigin },
): DecisionPolicyInput {
  return {
    schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
    envelope: {
      schemaVersion: 1,
      requestId: `req_${fixture.mode}_fixture`,
      sessionId: "sess_decision_fixture",
      mode: fixture.mode,
      origin: fixture.origin ?? "user",
      message: fixture.message,
      referencedArtifacts: [],
      createdAt: "2026-07-25T12:00:00.000Z",
    },
    understanding: fixture.understanding,
    repositoryState: fixture.repositoryState,
    approvalMode: fixture.approvalMode,
    planApproval: fixture.planApproval,
    hostCapabilities: fixture.hostCapabilities,
    windowPolicy: fixture.windowPolicy,
  };
}
