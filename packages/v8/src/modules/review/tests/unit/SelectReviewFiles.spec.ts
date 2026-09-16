import { describe, expect, it } from "vitest";

import { selectReviewFiles } from "../../actions/SelectReviewFiles";
import { reviewInputSchema } from "../../contracts";

function input(files: Parameters<typeof reviewInputSchema.parse>[0]["files"]) {
  return reviewInputSchema.parse({
    schemaVersion: 1,
    mode: "workspace",
    files,
  });
}

describe("selectReviewFiles", () => {
  it("selects normal source files", () => {
    const result = selectReviewFiles(
      input([
        {
          path: "src/app.ts",
          diff: "+const x = 1;\n",
          insertions: 1,
          deletions: 0,
        },
      ]),
    );
    expect(result.selectedCount).toBe(1);
    expect(result.decisions[0]?.excludeReason).toBe("none");
    expect(result.decisions[0]?.willReview).toBe(true);
  });

  it("excludes binary, user exclude, unsupported ext, default path, deleted, too_large", () => {
    const result = selectReviewFiles(
      input([
        { path: "a.bin", isBinary: true, diff: "" },
        { path: "src/skip.ts", diff: "+a\n", status: "modified" },
        { path: "readme.xyz", diff: "+a\n" },
        { path: "node_modules/pkg/index.js", diff: "+a\n" },
        { path: "src/gone.ts", isDeleted: true, deletions: 3 },
        {
          path: "src/huge.ts",
          diff: "x".repeat(200_000),
          insertions: 5000,
        },
      ]),
    );
    // Apply user exclude via filter in a second call
    const withFilter = selectReviewFiles(
      reviewInputSchema.parse({
        schemaVersion: 1,
        files: [{ path: "src/skip.ts", diff: "+a\n" }],
        filter: { exclude: ["src/skip.ts"], include: [] },
      }),
    );
    expect(withFilter.decisions[0]?.excludeReason).toBe("user_exclude");

    const byPath = Object.fromEntries(
      result.decisions.map((d) => [d.path, d.excludeReason]),
    );
    expect(byPath["a.bin"]).toBe("binary");
    expect(byPath["readme.xyz"]).toBe("unsupported_ext");
    expect(byPath["node_modules/pkg/index.js"]).toBe("default_path");
    expect(byPath["src/gone.ts"]).toBe("deleted");
    expect(byPath["src/huge.ts"]).toBe("too_large");
  });

  it("honors include override", () => {
    const result = selectReviewFiles(
      reviewInputSchema.parse({
        schemaVersion: 1,
        files: [
          { path: "docs/notes.md", diff: "+hi\n", insertions: 1 },
          { path: "src/a.ts", diff: "+hi\n", insertions: 1 },
        ],
        filter: { include: ["docs/**"], exclude: [] },
      }),
    );
    expect(result.decisions.find((d) => d.path === "docs/notes.md")?.willReview).toBe(
      true,
    );
    expect(result.decisions.find((d) => d.path === "src/a.ts")?.willReview).toBe(
      false,
    );
  });

  it("retains deletions without dispatching them", () => {
    const result = selectReviewFiles(
      input([{ path: "src/gone.ts", isDeleted: true, deletions: 2 }]),
    );
    expect(result.selectedCount).toBe(0);
    expect(result.retained).toHaveLength(1);
  });
});
