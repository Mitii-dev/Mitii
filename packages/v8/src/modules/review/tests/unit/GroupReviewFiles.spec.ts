import { describe, expect, it } from "vitest";

import { groupReviewFiles } from "../../actions/GroupReviewFiles";
import { reviewInputSchema } from "../../contracts";

describe("groupReviewFiles", () => {
  it("returns singleton for one file", () => {
    const input = reviewInputSchema.parse({
      schemaVersion: 1,
      files: [{ path: "a.ts", diff: "+1\n", insertions: 1 }],
    });
    const { groups } = groupReviewFiles({
      selected: input.files,
      input,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.paths).toEqual(["a.ts"]);
  });

  it("bundles a small change set", () => {
    const input = reviewInputSchema.parse({
      schemaVersion: 1,
      groupingMinFiles: 4,
      groupingBundleLineThreshold: 400,
      files: [
        { path: "a.ts", diff: "+1\n", insertions: 1 },
        { path: "b.ts", diff: "+1\n", insertions: 1 },
        { path: "c.ts", diff: "+1\n", insertions: 1 },
      ],
    });
    const { groups } = groupReviewFiles({
      selected: input.files,
      input,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("small change set");
  });

  it("uses per-file groups for large churn", () => {
    const input = reviewInputSchema.parse({
      schemaVersion: 1,
      groupingMinFiles: 2,
      groupingBundleLineThreshold: 10,
      files: [
        { path: "a.ts", diff: "+1\n", insertions: 50 },
        { path: "b.ts", diff: "+1\n", insertions: 50 },
        { path: "c.ts", diff: "+1\n", insertions: 50 },
      ],
    });
    const { groups } = groupReviewFiles({
      selected: input.files,
      input,
    });
    expect(groups).toHaveLength(3);
  });

  it("batches scan mode by extension", () => {
    const input = reviewInputSchema.parse({
      schemaVersion: 1,
      mode: "scan",
      scanBatchSize: 2,
      files: [
        { path: "a.ts", content: "a" },
        { path: "b.ts", content: "b" },
        { path: "c.ts", content: "c" },
        { path: "d.go", content: "d" },
      ],
    });
    const { groups } = groupReviewFiles({
      selected: input.files,
      input,
    });
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups.some((g) => g.label.includes(".ts"))).toBe(true);
  });
});
