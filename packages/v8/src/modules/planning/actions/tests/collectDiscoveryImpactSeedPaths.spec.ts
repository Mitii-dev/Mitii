import { describe, expect, it } from "vitest";

import { collectDiscoveryImpactSeedPaths } from "../collectDiscoveryImpactSeedPaths";

describe("collectDiscoveryImpactSeedPaths", () => {
  it("collects unique file targets and proposed change surfaces", () => {
    const paths = collectDiscoveryImpactSeedPaths({
      schemaVersion: 1,
      objective: "Fix payment retries",
      filesRead: [{ path: "src/payments/client.test.ts", reason: "test" }],
      targets: [
        {
          kind: "file",
          value: "src/payments/client.ts",
          reason: "entrypoint",
          explicit: false,
        },
        {
          kind: "folder",
          value: "src/payments",
          reason: "scope",
          explicit: true,
        },
      ],
      proposedChangeSurfaces: [
        {
          path: "src/payments/client.ts",
          actionHint: "Change",
          riskLevel: "medium",
          evidence: "missing retry",
        },
      ],
      discoveredConstraints: [],
      verificationHints: [],
      openQuestions: [],
      confidence: "high",
    });

    expect(paths).toEqual(["src/payments/client.ts"]);
  });
});
