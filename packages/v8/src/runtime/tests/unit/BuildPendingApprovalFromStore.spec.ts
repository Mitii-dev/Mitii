import { describe, expect, it } from "vitest";

import { buildPendingApprovalFromStore } from "../../helpers/parity/BuildPendingApprovalFromStore";

describe("buildPendingApprovalFromStore", () => {
  it("builds approval bag with fingerprint paths and summary", () => {
    const pending = buildPendingApprovalFromStore({
      pending: {
        toolId: "delete_file",
        invocationId: "inv_42",
        args: { path: "packages/schema/tsconfig.json" },
      },
    });
    expect(pending).toMatchObject({
      approvalId: "appr_inv_42",
      toolName: "delete_file",
      callId: "inv_42",
      paths: ["packages/schema/tsconfig.json"],
    });
    expect(pending?.fingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(pending?.summary).toMatch(/packages\/schema\/tsconfig\.json/);
  });

  it("falls back to gate tool ids when slice is missing args", () => {
    const pending = buildPendingApprovalFromStore({
      gateToolId: "run_command",
      gateInvocationId: "inv_cmd",
      pending: { args: { argv: ["git", "clean", "-fd"] } },
    });
    expect(pending?.toolName).toBe("run_command");
    expect(pending?.callId).toBe("inv_cmd");
    expect(pending?.summary).toMatch(/git/);
  });
});
