import { describe, expect, it } from "vitest";

import { resolveWorkRoot } from "../../helpers/orient/ResolveWorkRoot";

describe("resolveWorkRoot", () => {
  it("picks longest project id prefixing focus", () => {
    expect(
      resolveWorkRoot({
        focusPaths: ["packages/sdk/src/contracts.ts"],
        projects: [
          { id: "packages" },
          { id: "packages/sdk" },
          { id: "packages/v8" },
        ],
      }),
    ).toBe("packages/sdk");
  });

  it("returns undefined when no project matches", () => {
    expect(
      resolveWorkRoot({
        focusPaths: ["apps/cli/src/main.ts"],
        projects: [{ id: "packages/sdk" }],
      }),
    ).toBeUndefined();
  });

  it("ignores root '.' project ids", () => {
    expect(
      resolveWorkRoot({
        focusPaths: ["src/index.ts"],
        projects: [{ id: "." }, { id: "src" }],
      }),
    ).toBe("src");
  });
});
