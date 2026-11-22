export type { DecisionCaseFixture } from "./decisionCaseTypes";
export {
  createEnvelope,
  createInput,
  createUnderstanding,
} from "./decisionCaseBuilders";

import type { DecisionCaseFixture } from "./decisionCaseTypes";
import { DECISION_EVALUATION_CASES_CORE } from "./decisionCasesCore";
import { DECISION_EVALUATION_CASES_EXTENDED } from "./decisionCasesExtended";

export const DECISION_EVALUATION_CASES: DecisionCaseFixture[] = [
  ...DECISION_EVALUATION_CASES_CORE,
  ...DECISION_EVALUATION_CASES_EXTENDED,
];
