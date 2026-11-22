import type { GoldenDecisionCase } from "./decisionFixtureTypes";
import { createDecisionInput } from "./decisionFixtureHelpers";
import { GOLDEN_DECISION_CASES_EXTENDED } from "./goldenCasesExtended";
import { GOLDEN_DECISION_CASES_PLANNING } from "./goldenCasesPlanning";
import { GOLDEN_DECISION_CASES_POLICY } from "./goldenCasesPolicy";
import { GOLDEN_DECISION_CASES_ROUTING } from "./goldenCasesRouting";
import { GOLDEN_DECISION_CASES_VERIFICATION } from "./goldenCasesVerification";

/**
 * Human-reviewed golden suite — must pass 100% on every PR.
 */
export const GOLDEN_DECISION_CASES: GoldenDecisionCase[] = [
  ...GOLDEN_DECISION_CASES_ROUTING,
  ...GOLDEN_DECISION_CASES_PLANNING,
  ...GOLDEN_DECISION_CASES_POLICY,
  ...GOLDEN_DECISION_CASES_VERIFICATION,
  ...GOLDEN_DECISION_CASES_EXTENDED,
];

export { createDecisionInput };
