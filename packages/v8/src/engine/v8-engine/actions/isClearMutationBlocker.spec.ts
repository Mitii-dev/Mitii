import { describe, expect, it } from "vitest";

import { isClearMutationBlocker } from "./isClearMutationBlocker";

describe("isClearMutationBlocker", () => {
  it("accepts explicit Blocker header for DCO / command_not_allowed", () => {
    const answer = [
      "**Blocker:** No patchable workspace file can fix this.",
      "",
      "The DCO failure is on 12 commits missing Signed-off-by trailers.",
      "Adding them requires rewriting git commit objects, which apply_patch",
      "cannot do, and run_command rejects (command_not_allowed / read-only git).",
      "",
      "Run outside this session:",
      "git rebase --exec 'git commit --amend --no-edit --signoff' 9ee7a42",
    ].join("\n");
    expect(isClearMutationBlocker(answer)).toBe(true);
  });

  it("accepts command_not_allowed / no patchable file language without header", () => {
    const answer = [
      "This cannot be fixed by editing source files.",
      "run_command returned command_not_allowed for git rebase.",
      "Editing .github/workflows/dco.yml would not resolve the check.",
      "No patchable workspace file can add Signed-off-by trailers.",
    ].join(" ");
    expect(isClearMutationBlocker(answer)).toBe(true);
  });

  it("rejects transitional openers", () => {
    expect(
      isClearMutationBlocker(
        "Okay, let me try apply_patch on the dco workflow next after reading more files.",
      ),
    ).toBe(false);
  });
});
