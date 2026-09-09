import { describe, expect, it } from "vitest";

import {
  formatEffectiveGrant,
  formatEffectiveGrantJson,
} from "../../actions/FormatEffectiveGrant";
import type { ToolGrant } from "../../contracts";

const grant: ToolGrant = {
  maximumWorkspaceEffect: "read",
  allowedTools: ["read_file", "search_files", "glob_files"],
  allowedEffects: ["workspace_read"],
  pathScopes: ["."],
  commandRules: [
    { prefixes: ["git status", "git diff"], allowShellMetacharacters: false },
  ],
  approvalMode: "never",
  limits: {
    maxToolCalls: 32,
    maxWallTimeMs: 120_000,
    maxOutputBytes: 64_000,
  },
};

describe("formatEffectiveGrant", () => {
  it("includes effect, approval, tools, and command prefixes", () => {
    const text = formatEffectiveGrant(grant);
    expect(text).toContain("Effect: read");
    expect(text).toContain("Approval: never");
    expect(text).toContain("read_file");
    expect(text).toContain("git status");
  });

  it("emits stable JSON for host/CLI --json consumers", () => {
    const json = JSON.parse(formatEffectiveGrantJson(grant)) as {
      maximumWorkspaceEffect: string;
      allowedTools: string[];
    };
    expect(json.maximumWorkspaceEffect).toBe("read");
    expect(json.allowedTools).toEqual([
      "glob_files",
      "read_file",
      "search_files",
    ]);
  });
});
