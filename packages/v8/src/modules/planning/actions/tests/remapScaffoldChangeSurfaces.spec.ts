import { describe, expect, it } from "vitest";

import {
  remapScaffoldChangeSurfaces,
  resolveScaffoldPackageMapping,
} from "../remapScaffoldChangeSurfaces";

describe("resolveScaffoldPackageMapping", () => {
  it("maps create X like Y to package prefixes", () => {
    expect(
      resolveScaffoldPackageMapping({
        objective:
          "Create a package mui-builder like formik-form-builder with the same structure",
      }),
    ).toEqual({
      sourcePrefix: "packages/formik-form-builder",
      targetPrefix: "packages/mui-builder",
    });
  });

  it("maps full-port phrasing onto target and template packages", () => {
    expect(
      resolveScaffoldPackageMapping({
        objective:
          "Create packages/mui-builder as a full port of packages/formik-form-builder, but with MUI Material instead of Joy.",
      }),
    ).toEqual({
      sourcePrefix: "packages/formik-form-builder",
      targetPrefix: "packages/mui-builder",
    });
  });

  it("returns undefined for ordinary bugfix asks", () => {
    expect(
      resolveScaffoldPackageMapping({
        objective: "Fix the null crash in LoginForm.tsx",
        filesRead: [{ path: "src/LoginForm.tsx", reason: "bug" }],
      }),
    ).toBeUndefined();
  });
});

describe("remapScaffoldChangeSurfaces", () => {
  it("rewrites source-package write surfaces onto the target package", () => {
    const remapped = remapScaffoldChangeSurfaces({
      objective: "Scaffold packages/mui-builder from packages/formik-form-builder",
      surfaces: [
        {
          path: "packages/formik-form-builder/src/index.ts",
          actionHint: "Change",
          riskLevel: "low",
          evidence: "template entry",
        },
        {
          path: "packages/other/src/keep.ts",
          actionHint: "Change",
          riskLevel: "low",
          evidence: "unrelated",
        },
      ],
      filesRead: [
        {
          path: "packages/formik-form-builder/src/index.ts",
          reason: "template",
        },
      ],
    });

    expect(remapped.map((surface) => surface.path)).toEqual([
      "packages/mui-builder/src/index.ts",
      "packages/other/src/keep.ts",
    ]);
    expect(remapped[0]?.evidence).toContain("templated from");
  });
});
