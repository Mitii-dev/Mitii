import { describe, expect, it } from "vitest";

import { deriveEndingPosture } from "../../helpers/continuity/DeriveEndingPosture";

describe("deriveEndingPosture", () => {
  it("marks agent answer without mutations as proposal_ready", () => {
    expect(
      deriveEndingPosture({
        mode: "agent",
        route: "answer",
        status: "completed",
        mutationSucceeded: false,
      }),
    ).toBe("proposal_ready");
  });

  it("marks ask answer as answered", () => {
    expect(
      deriveEndingPosture({
        mode: "ask",
        route: "repository_answer",
        status: "completed",
        mutationSucceeded: false,
      }),
    ).toBe("answered");
  });

  it("marks successful mutations as mutated", () => {
    expect(
      deriveEndingPosture({
        mode: "agent",
        route: "execute",
        status: "completed",
        mutationSucceeded: true,
      }),
    ).toBe("mutated");
  });

  it("marks approval suspend as awaiting_approval", () => {
    expect(
      deriveEndingPosture({
        mode: "agent",
        route: "execute",
        status: "suspended",
        gateKind: "mutation_approval_required",
        mutationSucceeded: false,
      }),
    ).toBe("awaiting_approval");
  });

  it("marks clarify as awaiting_clarify", () => {
    expect(
      deriveEndingPosture({
        mode: "agent",
        route: "clarify",
        status: "suspended",
        mutationSucceeded: false,
      }),
    ).toBe("awaiting_clarify");
  });

  it("marks execute without mutations as incomplete", () => {
    expect(
      deriveEndingPosture({
        mode: "agent",
        route: "execute",
        status: "completed",
        mutationSucceeded: false,
      }),
    ).toBe("incomplete");
  });
});
