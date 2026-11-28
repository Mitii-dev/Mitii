import { describe, expect, it } from "vitest";

import { runStartEarlyPipeline } from "./executeStartEarlyPipeline";
import { runStartEarlyUnderstand } from "./executeStartEarlyUnderstand";
import { runStartEarlyDecide } from "./executeStartEarlyDecide";
import { createExecuteStartFinishers } from "./executeStartFinishHelpers";

describe("executeStart early pipeline split", () => {
  it("exports orchestrator and phase helpers", () => {
    expect(typeof runStartEarlyPipeline).toBe("function");
    expect(typeof runStartEarlyUnderstand).toBe("function");
    expect(typeof runStartEarlyDecide).toBe("function");
    expect(typeof createExecuteStartFinishers).toBe("function");
  });
});
