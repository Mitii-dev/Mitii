import { describe, expect, it } from "vitest";

import {
  createDiscoveryObservationCollector,
  hasDiscoveryReadPath,
  recordDiscoveryToolUse,
} from "../../internal/discoveryPass";

describe("hasDiscoveryReadPath", () => {
  it("detects normalized paths already recorded in the collector", () => {
    const collector = createDiscoveryObservationCollector();
    recordDiscoveryToolUse({
      collector,
      toolName: "read_file",
      argumentsValue: { path: "./test/shared/config/testConfig.ts" },
      resultOutput: {},
      status: "succeeded",
    });
    expect(
      hasDiscoveryReadPath(collector, "test/shared/config/testConfig.ts"),
    ).toBe(true);
    expect(hasDiscoveryReadPath(collector, "wdio.conf.ts")).toBe(false);
  });
});
