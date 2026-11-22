import { describe, expect, it } from "vitest";

import {
  changeLikePhaseName,
  isConcretePlanTargetRef,
  isConcretePlanVerification,
} from "../../internal/concretePlanTargets";

describe("isConcretePlanTargetRef", () => {
  it("accepts paths and symbols", () => {
    expect(isConcretePlanTargetRef("src/auth/login.ts")).toBe(true);
    expect(isConcretePlanTargetRef("packages/foo")).toBe(true);
    expect(isConcretePlanTargetRef("AuthService.login")).toBe(true);
    expect(isConcretePlanTargetRef("pkg::Item")).toBe(true);
  });

  it("rejects vague placeholders", () => {
    expect(isConcretePlanTargetRef("relevant files")).toBe(false);
    expect(isConcretePlanTargetRef("the codebase")).toBe(false);
    expect(isConcretePlanTargetRef("TBD")).toBe(false);
    expect(isConcretePlanTargetRef("[path needed]")).toBe(false);
  });
});

describe("isConcretePlanVerification", () => {
  it("accepts command-like and substantive checks", () => {
    expect(isConcretePlanVerification("pnpm test")).toBe(true);
    expect(isConcretePlanVerification("Re-run typecheck on the package")).toBe(
      true,
    );
  });

  it("rejects empty or placeholder text", () => {
    expect(isConcretePlanVerification(undefined)).toBe(false);
    expect(isConcretePlanVerification("tbd")).toBe(false);
    expect(isConcretePlanVerification("files")).toBe(false);
  });
});

describe("changeLikePhaseName", () => {
  it("matches change-like phase names", () => {
    expect(changeLikePhaseName("Change")).toBe(true);
    expect(changeLikePhaseName("Implement")).toBe(true);
    expect(changeLikePhaseName("Verify")).toBe(false);
  });
});
