import { describe, expect, it } from "vitest";

import {
  REVIEW_RECORD_SCHEMA_VERSION,
  REVIEW_SCHEMA_VERSION,
  reviewFindingSchema,
  reviewRecordSchema,
} from "../../index";

describe("ReviewFinding contract", () => {
  it("round-trips a minimal finding", () => {
    const parsed = reviewFindingSchema.parse({
      path: "src/a.ts",
      content: "Possible null deref",
      existingCode: "const x = obj.value;",
      category: "bug",
      severity: "high",
    });
    expect(parsed.anchored).toBe(false);
    expect(parsed.category).toBe("bug");
  });

  it("rejects endLine < startLine", () => {
    expect(() =>
      reviewFindingSchema.parse({
        path: "src/a.ts",
        content: "x",
        existingCode: "y",
        startLine: 10,
        endLine: 2,
      }),
    ).toThrow();
  });
});

describe("ReviewRecord contract", () => {
  it("requires mitii.review/v1 schemaVersion", () => {
    const now = new Date().toISOString();
    const parsed = reviewRecordSchema.parse({
      schemaVersion: REVIEW_RECORD_SCHEMA_VERSION,
      recordId: "r1",
      capturedAt: now,
      updatedAt: now,
      status: "complete",
      mode: "workspace",
      effort: "medium",
      reasonCodes: ["review_complete"],
    });
    expect(parsed.schemaVersion).toBe("mitii.review/v1");
    expect(REVIEW_SCHEMA_VERSION).toBe(1);
  });
});
