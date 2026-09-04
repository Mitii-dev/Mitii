import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadUserSafetyRules,
  USER_SAFETY_RULES_FILENAME,
} from "./loadUserSafetyRules.js";

describe("loadUserSafetyRules", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns disabled defaults when file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "mitii-safety-"));
    dirs.push(root);
    const rules = loadUserSafetyRules(root);
    expect(rules.enabled).toBe(false);
  });

  it("parses enabled tighten-only rules", () => {
    const root = mkdtempSync(join(tmpdir(), "mitii-safety-"));
    dirs.push(root);
    mkdirSync(join(root, ".mitii"), { recursive: true });
    writeFileSync(
      join(root, ".mitii", USER_SAFETY_RULES_FILENAME),
      JSON.stringify({
        enabled: true,
        denyTools: ["delete_directory"],
        denyCommandPrefixes: ["rm"],
        approvalCeiling: "when_required",
      }),
      "utf8",
    );
    const rules = loadUserSafetyRules(root);
    expect(rules.enabled).toBe(true);
    expect(rules.denyTools).toContain("delete_directory");
    expect(rules.denyCommandPrefixes).toContain("rm");
    expect(rules.approvalCeiling).toBe("when_required");
  });

  it("fails soft on invalid JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "mitii-safety-"));
    dirs.push(root);
    mkdirSync(join(root, ".mitii"), { recursive: true });
    writeFileSync(
      join(root, ".mitii", USER_SAFETY_RULES_FILENAME),
      "{not-json",
      "utf8",
    );
    expect(loadUserSafetyRules(root).enabled).toBe(false);
  });
});
