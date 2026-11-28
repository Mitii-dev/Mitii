import { describe, expect, it } from "vitest";

import { BROWSER_E2E_TEST_PATTERN } from "../../../modules/verification";
import {
  discoverChecksFromCatalog,
  isHeavyVerificationCandidate,
  omitHeavyVerificationChecks,
} from "../../helpers/verify";

describe("S12-HEAVY + S12-DISCOVER", () => {
  it("never auto-allows playwright/cypress/wdio/e2e scripts", () => {
    const result = omitHeavyVerificationChecks({
      candidates: [
        "test",
        "test:e2e",
        "playwright",
        "cypress:run",
        "wdio",
        "typecheck",
        "emulator:android",
      ],
    });
    expect(result.allowed).toEqual(["test", "typecheck"]);
    expect(result.omitted.map((o) => o.reason)).toEqual(
      expect.arrayContaining([
        "browser_e2e_gated",
        "emulator_gated",
      ]),
    );
    expect(result.reasonCodes).toContain("verify_heavy_omitted");
  });

  it("allowHeavy keeps e2e candidates when explicit", () => {
    const result = omitHeavyVerificationChecks({
      candidates: ["test:e2e", "typecheck"],
      allowHeavy: true,
    });
    expect(result.allowed).toContain("test:e2e");
    expect(result.reasonCodes).toContain("verify_heavy_explicitly_allowed");
  });

  it("BROWSER_E2E_TEST_PATTERN matches locked tokens", () => {
    expect(BROWSER_E2E_TEST_PATTERN.test("playwright")).toBe(true);
    expect(BROWSER_E2E_TEST_PATTERN.test("test:unit")).toBe(false);
    expect(isHeavyVerificationCandidate("tablet:test")).toBe(true);
  });

  it("discoverChecksFromCatalog maps scripts and omits heavy", () => {
    const result = discoverChecksFromCatalog({
      projects: [
        {
          id: "app",
          scripts: {
            typecheck: "tsc -p .",
            test: "vitest run",
            "test:e2e": "playwright test",
            lint: "eslint .",
          },
        },
      ],
    });
    expect(result.checks).toEqual(
      expect.arrayContaining(["diagnostics", "typecheck", "tests", "lint"]),
    );
    expect(result.scriptHints).not.toContain("test:e2e");
    expect(result.omitted.some((o) => o.candidate === "test:e2e")).toBe(true);
    expect(result.reasonCodes).toContain("verify_discover_from_catalog");
  });

  it("discoverChecksFromCatalog reports unavailable without inventing", () => {
    const result = discoverChecksFromCatalog({ projects: [] });
    expect(result.checks).toEqual(["diagnostics", "diff_review"]);
    expect(result.unavailableReasons).toContain("catalog_projects_missing");
  });
});
