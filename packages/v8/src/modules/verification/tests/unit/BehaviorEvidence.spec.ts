import { describe, expect, it } from "vitest";

import type { VerificationCheckResult } from "../../contracts";
import type { DiscoveredCheckCandidate } from "../../helpers/discovery";
import { assessTaskRelevantEvidence } from "../../helpers/AssessTaskRelevantEvidence";
import {
  hasBehaviorDefect,
  hasPassedBehaviorCheck,
  isBehaviorDefectCheck,
  requiresBehaviorEvidence,
} from "../../helpers/BehaviorEvidence";
import { recommendCompletion } from "../../flow/steps/7-recommend-completion";
import { selectProportionalChecks } from "../../flow/steps/3-select-checks";

function check(
  partial: Partial<VerificationCheckResult> &
    Pick<VerificationCheckResult, "checkId" | "kind" | "outcome">,
): VerificationCheckResult {
  return {
    projectId: "inferred:packages/api",
    label: partial.checkId,
    evidenceSource: "manifest",
    summary: partial.summary ?? partial.outcome,
    ...partial,
  };
}

const typecheckPassed = check({
  checkId: "inferred:packages/api:typecheck:tsc",
  kind: "typecheck",
  outcome: "passed",
});

describe("BehaviorEvidence helpers", () => {
  it("detects the behavior evidence kind", () => {
    expect(requiresBehaviorEvidence(["tests", "behavior"])).toBe(true);
    expect(requiresBehaviorEvidence(["tests"])).toBe(false);
  });

  it("classifies failed non-empty test checks as defects", () => {
    const failed = check({
      checkId: "inferred:packages/api:test:test",
      kind: "test",
      outcome: "failed",
      summary: "expected 200 received 404",
    });
    expect(isBehaviorDefectCheck(failed, [typecheckPassed, failed])).toBe(true);
    expect(hasBehaviorDefect([typecheckPassed, failed])).toBe(true);
  });

  it("does not classify empty-suite exits or non-test checks as defects", () => {
    const empty = check({
      checkId: "inferred:packages/api:test:test",
      kind: "test",
      outcome: "failed",
      summary: "No test files found",
    });
    expect(hasBehaviorDefect([empty])).toBe(false);
    expect(
      hasBehaviorDefect([
        check({ checkId: "a:typecheck", kind: "typecheck", outcome: "failed" }),
      ]),
    ).toBe(false);
  });

  it("reports passed behavior evidence only for test checks", () => {
    expect(hasPassedBehaviorCheck([typecheckPassed])).toBe(false);
    expect(
      hasPassedBehaviorCheck([
        check({ checkId: "t", kind: "test", outcome: "passed" }),
      ]),
    ).toBe(true);
  });
});

describe("behavior evidence coverage and assessment", () => {
  it("typecheck alone does not cover behavior evidence", () => {
    const result = recommendCompletion({
      verification: {
        required: true,
        minimumEvidence: ["diagnostics", "tests", "behavior"],
        allowUnavailable: false,
      },
      checks: [typecheckPassed],
      cancelled: false,
      staleStateRisk: false,
      stateUnavailable: false,
    });
    expect(result.status).toBe("implemented_unverified");
  });

  it("a passed test check covers behavior evidence", () => {
    const result = recommendCompletion({
      verification: {
        required: true,
        minimumEvidence: ["behavior"],
        allowUnavailable: false,
      },
      checks: [check({ checkId: "t", kind: "test", outcome: "passed" })],
      cancelled: false,
      staleStateRisk: false,
      stateUnavailable: false,
    });
    expect(result.status).toBe("verified_success");
  });

  it("assessor refuses to soft-accept a failed suite only when behavior is required", () => {
    const failedTest = check({
      checkId: "inferred:packages/api:test:test",
      kind: "test",
      outcome: "failed",
      summary: "route returned 404",
    });
    const base = {
      checks: [typecheckPassed, failedTest],
      diagnostics: [],
    };
    expect(
      assessTaskRelevantEvidence({
        ...base,
        verification: {
          required: true,
          minimumEvidence: ["tests"],
          allowUnavailable: true,
        },
      }).shouldAccept,
    ).toBe(true);
    const strict = assessTaskRelevantEvidence({
      ...base,
      verification: {
        required: true,
        minimumEvidence: ["tests", "behavior"],
        allowUnavailable: true,
      },
    });
    expect(strict.shouldAccept).toBe(false);
    expect(strict.residualKind).toBe("unclassified_failure");
  });
});

describe("selectProportionalChecks with behavior evidence", () => {
  const typecheck: DiscoveredCheckCandidate = {
    checkId: "inferred:packages/api:typecheck:tsc",
    kind: "typecheck",
    projectId: "inferred:packages/api",
    label: "tsc",
    evidenceSource: "manifest",
    languageId: "typescript",
    toolName: "run_readonly_command",
    toolArguments: { argv: ["npx", "tsc", "--noEmit"] },
    argv: ["npx", "tsc", "--noEmit"],
  };
  const unitTest: DiscoveredCheckCandidate = {
    ...typecheck,
    checkId: "inferred:packages/api:test:test",
    kind: "test",
    label: "npm test",
    toolArguments: { argv: ["npm", "test"] },
    argv: ["npm", "test"],
  };

  it("selects the test candidate when only behavior evidence is required", () => {
    const result = selectProportionalChecks({
      candidates: [typecheck, unitTest],
      verification: {
        required: true,
        minimumEvidence: ["diagnostics", "behavior"],
        allowUnavailable: false,
      },
      changeScope: "localized",
      changedFiles: ["packages/api/src/routes.ts"],
    });
    expect(result.selected.map((c) => c.kind)).toContain("test");
  });

  it("omits the test candidate without behavior/tests evidence", () => {
    const result = selectProportionalChecks({
      candidates: [typecheck, unitTest],
      verification: {
        required: true,
        minimumEvidence: ["diagnostics", "diff_review"],
        allowUnavailable: false,
      },
      changeScope: "localized",
      changedFiles: ["packages/api/src/routes.ts"],
    });
    expect(result.selected.map((c) => c.kind)).not.toContain("test");
  });
});
