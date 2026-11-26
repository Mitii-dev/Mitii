import { describe, expect, it } from "vitest";

import {
  allowsTargetedDiscoveryAfterRejectedMutation,
  buildRejectedMutationRecoveryMessage,
  buildRejectedToolRecoveryMessage,
} from "../../../helpers/tool-recovery";

describe("rejected tool recovery", () => {
  it("builds a mutation recovery message that forbids broad exploration", () => {
    const message = buildRejectedMutationRecoveryMessage({
      toolName: "apply_patch",
      status: "rejected",
      reasonCode: "grant_denied",
      warnings: [],
    });
    expect(message).toMatch(/apply_patch/);
    expect(message).toMatch(/Do not restart broad exploration/i);
  });

  it("builds a generic rejected tool recovery message", () => {
    const message = buildRejectedToolRecoveryMessage({
      toolName: "run_command",
      status: "rejected",
      reasonCode: "command_not_allowed",
      warnings: ["blocked"],
    });
    expect(message).toMatch(/run_command/);
    expect(message).toMatch(/blocked/);
  });

  it("allows targeted discovery after path_out_of_scope rejection", () => {
    expect(
      allowsTargetedDiscoveryAfterRejectedMutation({
        toolName: "apply_patch",
        reasonCode: "path_out_of_scope",
        warnings: [],
      }),
    ).toBe(true);
  });
});
