import { describe, expect, it } from "vitest";

import { GrantValidationError } from "../actions/ValidateGrant";
import { assertSafeGitPushArgv } from "../actions/ExecuteGithubMutation";

describe("assertSafeGitPushArgv", () => {
  it("allows push to a feature branch", () => {
    expect(() =>
      assertSafeGitPushArgv(["git", "push", "origin", "feat/cover"]),
    ).not.toThrow();
  });

  it("refuses push to main/master", () => {
    expect(() =>
      assertSafeGitPushArgv(["git", "push", "origin", "main"]),
    ).toThrow(GrantValidationError);
    expect(() =>
      assertSafeGitPushArgv(["git", "push", "origin", "HEAD:master"]),
    ).toThrow(GrantValidationError);
  });

  it("refuses ambiguous git push", () => {
    expect(() => assertSafeGitPushArgv(["git", "push"])).toThrow(
      GrantValidationError,
    );
    expect(() => assertSafeGitPushArgv(["git", "push", "origin"])).toThrow(
      GrantValidationError,
    );
  });
});
