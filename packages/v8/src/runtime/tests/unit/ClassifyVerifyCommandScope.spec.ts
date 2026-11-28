import { describe, expect, it } from "vitest";

import { classifyVerifyCommandScope } from "../../helpers/task/ClassifyVerifyCommandScope";

describe("classifyVerifyCommandScope", () => {
  it("treats node --test with file paths as selective", () => {
    expect(
      classifyVerifyCommandScope([
        "node",
        "--test",
        "packages/checks/test/http-check.test.js",
      ]),
    ).toBe("selective");
  });

  it("treats package-manager suite scripts as broad", () => {
    expect(
      classifyVerifyCommandScope([
        "pnpm",
        "--filter",
        "@mitii-bench/checks",
        "test",
      ]),
    ).toBe("broad");
    expect(classifyVerifyCommandScope(["npm", "test"])).toBe("broad");
  });
});
