import { describe, expect, it } from "vitest";

import {
  PLANNING_SCHEMA_VERSION,
  PlanningPipeline,
  compileDiscoveryBrief,
  discoveryBriefSchema,
  discoveryObservationSchema,
} from "../index";

describe("DiscoveryBrief contract", () => {
  it("accepts a generic evidence brief and rejects mutable task state", () => {
    const brief = discoveryBriefSchema.parse({
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Add a retry wrapper around the payment client",
      filesRead: [
        {
          path: "src/payments/client.ts",
          reason: "Entrypoint for outbound payment calls",
          symbols: ["createCharge"],
        },
      ],
      targets: [
        {
          kind: "file",
          value: "src/payments/client.ts",
          reason: "Observed call site",
          explicit: false,
        },
      ],
      proposedChangeSurfaces: [
        {
          path: "src/payments/client.ts",
          actionHint: "Change",
          riskLevel: "medium",
          evidence: "Retries are missing around createCharge",
        },
      ],
      discoveredConstraints: ["Keep existing error mapping"],
      verificationHints: [
        { kind: "test", reason: "Nearby client test covers success path" },
      ],
      openQuestions: [],
      confidence: "high",
    });
    expect(brief.schemaVersion).toBe(1);
    expect(brief.filesRead[0]?.path).toBe("src/payments/client.ts");
    expect(
      discoveryBriefSchema.safeParse({
        ...brief,
        items: [{ id: "todo", status: "active" }],
      }).success,
    ).toBe(false);
  });

  it("compiles observations into concrete surfaces and low-confidence questions", () => {
    const compiled = compileDiscoveryBrief(
      discoveryObservationSchema.parse({
        schemaVersion: 1,
        objective: "Add a retry wrapper around the payment client",
        filesRead: [
          {
            path: "src/payments/client.ts",
            reason: "Read payment client",
          },
          {
            path: "src/payments/retry.ts",
            reason: "Read retry helper",
          },
          {
            path: "src/payments/client.test.ts",
            reason: "Read nearby test",
          },
        ],
        searchHits: [
          { path: "src/payments/client.ts", reason: "Matched createCharge" },
        ],
        constraints: ["Keep existing error mapping"],
      }),
    );
    expect(compiled.proposedChangeSurfaces.map((item) => item.path)).toEqual([
      "src/payments/client.ts",
      "src/payments/retry.ts",
    ]);
    expect(compiled.verificationHints.some((hint) => hint.kind === "test")).toBe(
      true,
    );
    expect(compiled.confidence).toBe("high");

    const empty = compileDiscoveryBrief({
      schemaVersion: 1,
      objective: "Investigate the request",
    });
    expect(empty.confidence).toBe("low");
    expect(empty.proposedChangeSurfaces).toEqual([]);
    expect(empty.openQuestions.length).toBeGreaterThan(0);
  });

  it("does not treat config-only reads as high-confidence change surfaces", () => {
    const compiled = compileDiscoveryBrief({
      schemaVersion: 1,
      objective: "Fix all the ts erros in this package",
      filesRead: [
        { path: "packages/mui-builder/package.json", reason: "Read package manifest" },
        { path: "packages/mui-builder/tsconfig.json", reason: "Read tsconfig" },
      ],
    });
    expect(compiled.proposedChangeSurfaces).toEqual([]);
    expect(compiled.confidence).toBe("low");
    expect(compiled.openQuestions.length).toBeGreaterThan(0);
  });

  it("exposes compileDiscovery on the Planning facade", () => {
    const pipeline = new PlanningPipeline();
    const brief = pipeline.compileDiscovery({
      schemaVersion: 1,
      objective: "Inspect config loading",
      filesRead: [
        { path: "src/config/load.ts", reason: "Config loader" },
      ],
    });
    expect(discoveryBriefSchema.parse(brief).targets[0]?.value).toBe(
      "src/config/load.ts",
    );
  });
});
