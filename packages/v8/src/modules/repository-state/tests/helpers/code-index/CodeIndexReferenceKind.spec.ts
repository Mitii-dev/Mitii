import { describe, expect, it } from "vitest";

import { codeIndexReferenceSchema } from "../../../helpers/code-index/schema";

describe("codeIndexReferenceSchema", () => {
  it("accepts SCIP/tree-sitter kind reference", () => {
    const parsed = codeIndexReferenceSchema.safeParse({
      fromFileId: "file_1",
      symbolName: "composeAgentEngine",
      kind: "reference",
      resolution: "resolved",
      toFileId: "file_2",
      line: 12,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts definition kind from tree-sitter capture rows", () => {
    const parsed = codeIndexReferenceSchema.safeParse({
      fromFileId: "file_1",
      symbolName: "StoreManager",
      kind: "definition",
      resolution: "unresolved",
      line: 4,
    });
    expect(parsed.success).toBe(true);
  });
});
