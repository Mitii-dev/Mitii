import { describe, expect, it } from "vitest";

import {
  isRuntimeFlowStepId,
  RUNTIME_FLOW_STEP_IDS,
} from "../../flow/order";

describe("RUNTIME_FLOW_STEP_IDS", () => {
  it("locks the §17 eleven-step spine", () => {
    expect(RUNTIME_FLOW_STEP_IDS).toHaveLength(11);
    expect(RUNTIME_FLOW_STEP_IDS[0]).toBe("1-window-policy");
    expect(RUNTIME_FLOW_STEP_IDS[10]).toBe("11-verify-finish");
    expect(isRuntimeFlowStepId("5-decide")).toBe(true);
    expect(isRuntimeFlowStepId("nope")).toBe(false);
  });
});
