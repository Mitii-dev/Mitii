import { describe, expect, it } from "vitest";

import {
  grantNeverWidens,
  intersectUserSafetyRules,
} from "../../actions/IntersectUserSafetyRules";
import type { ToolGrant, UserSafetyRules } from "../../contracts";

function baseWriteGrant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: [
      "read_file",
      "apply_patch",
      "run_command",
      "delete_file",
      "delete_directory",
    ],
    allowedEffects: ["workspace_read", "workspace_write", "process_execute"],
    pathScopes: [".", "src"],
    mutationPathScopes: ["src"],
    commandRules: [
      {
        prefixes: ["pnpm", "npm", "rm", "git", "sudo"],
        allowShellMetacharacters: false,
      },
    ],
    networkHosts: ["registry.npmjs.org", "evil.example"],
    approvalMode: "never",
    limits: {
      maxToolCalls: 64,
      maxWallTimeMs: 600_000,
      maxOutputBytes: 1_000_000,
    },
    mutationBudget: {
      maxPatchesPerCall: 8,
      maxUniqueFilesPerCall: 4,
      maxPatchPayloadCharacters: 40_000,
      preferredBatchSize: 2,
      requireBatchedExecution: false,
    },
    ...overrides,
  };
}

describe("intersectUserSafetyRules", () => {
  it("is a no-op when rules are disabled or missing", () => {
    const grant = baseWriteGrant();
    const disabled = intersectUserSafetyRules(grant, {
      enabled: false,
      denyTools: ["apply_patch"],
      denyCommandPrefixes: [],
      denyPathScopes: [],
      denyNetworkHosts: [],
    });
    expect(disabled.tightened).toBe(false);
    expect(disabled.toolGrant.allowedTools).toContain("apply_patch");

    const missing = intersectUserSafetyRules(grant, undefined);
    expect(missing.tightened).toBe(false);
  });

  it("never_widens when denying tools and prefixes", () => {
    const before = baseWriteGrant();
    const rules: UserSafetyRules = {
      enabled: true,
      denyTools: ["delete_directory", "delete_file"],
      denyCommandPrefixes: ["rm", "sudo"],
      allowCommandPrefixes: ["pnpm", "npm", "git"],
      denyPathScopes: [],
      denyNetworkHosts: ["evil.example"],
      approvalCeiling: "when_required",
    };
    const after = intersectUserSafetyRules(before, rules);
    expect(after.tightened).toBe(true);
    expect(grantNeverWidens(before, after.toolGrant)).toBe(true);
    expect(after.toolGrant.allowedTools).not.toContain("delete_directory");
    expect(after.toolGrant.allowedTools).toContain("apply_patch");
    const prefixes =
      after.toolGrant.commandRules?.flatMap((r) => r.prefixes) ?? [];
    expect(prefixes).toEqual(expect.arrayContaining(["pnpm", "npm", "git"]));
    expect(prefixes).not.toContain("rm");
    expect(prefixes).not.toContain("sudo");
    expect(after.toolGrant.networkHosts).not.toContain("evil.example");
    expect(after.toolGrant.approvalMode).toBe("when_required");
  });

  it("cannot add tools that policy did not grant", () => {
    const before = baseWriteGrant({
      allowedTools: ["read_file", "apply_patch"],
      commandRules: undefined,
    });
    const rules: UserSafetyRules = {
      enabled: true,
      denyTools: [],
      denyCommandPrefixes: [],
      // Attempt to "allow" a tool via command allow-list only — must not invent tools.
      allowCommandPrefixes: ["pnpm", "curl"],
      denyPathScopes: [],
      denyNetworkHosts: [],
    };
    const after = intersectUserSafetyRules(before, rules);
    expect(after.toolGrant.allowedTools).toEqual(["read_file", "apply_patch"]);
    expect(grantNeverWidens(before, after.toolGrant)).toBe(true);
  });

  it("downgrades write effect when mutation tools are denied", () => {
    const before = baseWriteGrant();
    const after = intersectUserSafetyRules(before, {
      enabled: true,
      denyTools: ["apply_patch", "delete_file", "delete_directory", "move_file"],
      denyCommandPrefixes: [],
      denyPathScopes: [],
      denyNetworkHosts: [],
    });
    expect(after.toolGrant.maximumWorkspaceEffect).not.toBe("write");
    expect(after.toolGrant.mutationBudget).toBeUndefined();
    expect(grantNeverWidens(before, after.toolGrant)).toBe(true);
  });

  it("never lowers approval strictness via ceiling", () => {
    const before = baseWriteGrant({ approvalMode: "every_mutation" });
    const after = intersectUserSafetyRules(before, {
      enabled: true,
      denyTools: [],
      denyCommandPrefixes: [],
      denyPathScopes: [],
      denyNetworkHosts: [],
      approvalCeiling: "never",
    });
    expect(after.toolGrant.approvalMode).toBe("every_mutation");
    expect(grantNeverWidens(before, after.toolGrant)).toBe(true);
  });
});
