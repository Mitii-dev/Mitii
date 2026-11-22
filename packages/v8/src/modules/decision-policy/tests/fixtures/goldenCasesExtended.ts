import type { GoldenDecisionCase } from "./decisionFixtureTypes";
import { GOLDEN_DECISION_CASES_EXTENDED_A } from "./goldenCasesExtendedRouting";
import { GOLDEN_DECISION_CASES_EXTENDED_B } from "./goldenCasesExtendedPolicy";

/** Additional golden cases beyond the core suite. */
export const GOLDEN_DECISION_CASES_EXTENDED: GoldenDecisionCase[] = [
  ...GOLDEN_DECISION_CASES_EXTENDED_A,
  ...GOLDEN_DECISION_CASES_EXTENDED_B,
];
