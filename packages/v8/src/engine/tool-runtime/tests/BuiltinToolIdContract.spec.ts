import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_TOOL_IDS as TR_CHANGE_IMPACT,
  CODE_INTELLIGENCE_TOOL_IDS as TR_CODE_INTEL,
  DIAGNOSTICS_TOOL_IDS as TR_DIAGNOSTICS,
  GITHUB_MUTATION_TOOL_IDS as TR_GITHUB,
  GIT_MUTATION_TOOL_IDS as TR_GIT,
  MUTATION_TOOL_IDS as TR_MUTATION,
  PROCESS_TOOL_IDS as TR_PROCESS,
  READ_ONLY_TOOL_IDS as TR_READ_ONLY,
} from "../constants";
import {
  CHANGE_IMPACT_TOOL_IDS as DP_CHANGE_IMPACT,
  CODE_INTELLIGENCE_TOOL_IDS as DP_CODE_INTEL,
  DIAGNOSTICS_TOOL_IDS as DP_DIAGNOSTICS,
  GITHUB_MUTATION_TOOL_IDS as DP_GITHUB,
  GIT_MUTATION_TOOL_IDS as DP_GIT,
  MUTATION_TOOL_IDS as DP_MUTATION,
  PROCESS_TOOL_IDS as DP_PROCESS,
  READ_ONLY_TOOL_IDS as DP_READ_ONLY,
} from "../../../modules/decision-policy/constants";
import { ADVERSARY_HIGH_RISK_TOOL_IDS } from "../internal/adversary";

/**
 * R7/R10: Decision Policy tool ID lists must be the same arrays owned by
 * Tool Runtime (re-export, not a hand-maintained twin).
 */
describe("builtin tool ID contract (TR ↔ Decision Policy)", () => {
  it("re-exports the same READ_ONLY / MUTATION / family arrays", () => {
    expect(DP_READ_ONLY).toBe(TR_READ_ONLY);
    expect(DP_MUTATION).toBe(TR_MUTATION);
    expect(DP_GITHUB).toBe(TR_GITHUB);
    expect(DP_GIT).toBe(TR_GIT);
    expect(DP_PROCESS).toBe(TR_PROCESS);
    expect(DP_CODE_INTEL).toBe(TR_CODE_INTEL);
    expect(DP_DIAGNOSTICS).toBe(TR_DIAGNOSTICS);
    expect(DP_CHANGE_IMPACT).toBe(TR_CHANGE_IMPACT);
  });

  it("includes emit_review_finding in READ_ONLY (R7)", () => {
    expect(TR_READ_ONLY).toContain("emit_review_finding");
  });

  it("lists GitHub mutation tools separately from default MUTATION (R10)", () => {
    expect(TR_GITHUB).toEqual([
      "create_github_issue",
      "create_pull_request",
    ]);
    for (const id of TR_GITHUB) {
      expect(TR_MUTATION).not.toContain(id);
    }
  });

  it("lists git_signoff_range as a dedicated git mutation tool", () => {
    expect(TR_GIT).toEqual(["git_signoff_range"]);
    expect(TR_MUTATION).not.toContain("git_signoff_range");
  });

  it("keeps apply_patch out of adversary high-risk (grant/budget owns writes)", () => {
    expect(ADVERSARY_HIGH_RISK_TOOL_IDS).not.toContain("apply_patch");
    expect(ADVERSARY_HIGH_RISK_TOOL_IDS).toContain("run_command");
    expect(ADVERSARY_HIGH_RISK_TOOL_IDS).toContain("create_pull_request");
    expect(ADVERSARY_HIGH_RISK_TOOL_IDS).toContain("git_signoff_range");
  });
});
