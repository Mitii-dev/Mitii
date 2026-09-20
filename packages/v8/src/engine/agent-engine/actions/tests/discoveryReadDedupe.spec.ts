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

describe("recordDiscoveryToolUse symbols", () => {
  it("attaches symbol names from document_symbol onto filesRead", () => {
    const collector = createDiscoveryObservationCollector();
    recordDiscoveryToolUse({
      collector,
      toolName: "read_file",
      argumentsValue: { path: "src/payments/client.ts" },
      resultOutput: { content: "export function pay() {}" },
      status: "succeeded",
    });
    recordDiscoveryToolUse({
      collector,
      toolName: "document_symbol",
      argumentsValue: { path: "src/payments/client.ts" },
      resultOutput: {
        symbols: [{ name: "pay" }, { name: "PaymentClient" }],
      },
      status: "succeeded",
    });

    const file = collector.filesRead.find(
      (entry) => entry.path === "src/payments/client.ts",
    );
    expect(file?.symbols).toEqual(expect.arrayContaining(["pay", "PaymentClient"]));
  });
});
