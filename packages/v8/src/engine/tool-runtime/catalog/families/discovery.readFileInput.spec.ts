import { describe, expect, it } from "vitest";

import { readFileInputSchema } from "./discovery";

describe("readFileInputSchema normalization", () => {
  it("maps line → startLine and accepts the call", () => {
    const parsed = readFileInputSchema.parse({
      path: "src/a.ts",
      line: 40,
      maxLines: 60,
    });
    expect(parsed).toEqual({
      path: "src/a.ts",
      startLine: 40,
      maxLines: 60,
    });
  });

  it("drops head when startLine/endLine/maxLines are present", () => {
    const parsed = readFileInputSchema.parse({
      path: "src/a.ts",
      head: 50,
      startLine: 1,
      endLine: 200,
    });
    expect(parsed).toEqual({
      path: "src/a.ts",
      startLine: 1,
      endLine: 200,
    });
  });
});
