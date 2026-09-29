import { describe, expect, it } from "vitest";

import { buildMissingModuleStubPatches } from "../buildMissingModuleStubPatches";

describe("buildMissingModuleStubPatches", () => {
  it("resolves relative TS2307 modules into create-file patches", () => {
    const patches = buildMissingModuleStubPatches({
      diagnostics: [
        {
          path: "test/Desktop/components/HeaderComponent.ts",
          severity: "error",
          message:
            "Cannot find module '../selectors/Header.selectors' or its corresponding type declarations.",
          code: "TS2307",
          source: "tsc",
        },
        {
          path: "test/Desktop/pages/NavigationPage.ts",
          severity: "error",
          message: "Class 'NavigationPage' incorrectly extends base class 'BasePage'.",
          code: "TS2415",
          source: "tsc",
        },
      ],
      pathScopes: ["."],
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]?.path).toBe(
      "test/Desktop/selectors/Header.selectors.ts",
    );
    expect(patches[0]?.oldText).toBe("");
    expect(patches[0]?.newText).toContain("export default class HeaderSelectors");
  });

  it("appends .ts when the module basename contains dots (not a real extension)", () => {
    const patches = buildMissingModuleStubPatches({
      diagnostics: [
        {
          path: "src/a.ts",
          severity: "error",
          message: "Cannot find module './foo.bar.baz'",
          code: "TS2307",
          source: "tsc",
        },
      ],
    });
    expect(patches[0]?.path).toBe("src/foo.bar.baz.ts");
  });

  it("dedupes the same missing module from multiple importers", () => {
    const patches = buildMissingModuleStubPatches({
      diagnostics: [
        {
          path: "a/One.ts",
          severity: "error",
          message: "Cannot find module './Missing'",
          code: "TS2307",
          source: "tsc",
        },
        {
          path: "a/Two.ts",
          severity: "error",
          message: "Cannot find module './Missing'",
          code: "TS2307",
          source: "tsc",
        },
      ],
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]?.path).toBe("a/Missing.ts");
  });
});
