import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BUILTIN_MODE_PROFILES,
  compileModeProfile,
  loadModeProfiles,
  mergeUserSafetyRules,
  MODE_CATALOG_FILENAME,
  resolveModeProfile,
} from "./index.js";

describe("mode profiles", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ships builtin architect/code/ask/debug overlays", () => {
    const slugs = BUILTIN_MODE_PROFILES.map((profile) => profile.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(["architect", "code", "ask", "debug"]),
    );
  });

  it("compiles architect to plan mode with markdown mutation regex", () => {
    const architect = BUILTIN_MODE_PROFILES.find(
      (profile) => profile.slug === "architect",
    )!;
    const compiled = compileModeProfile(architect);
    expect(compiled.agentMode).toBe("plan");
    expect(compiled.userSafetyRules.enabled).toBe(true);
    expect(compiled.userSafetyRules.mutationRelativePathRegex).toBe("\\.md$");
    expect(compiled.userSafetyRules.denyTools).toContain("run_command");
    expect(compiled.userSafetyRules.denyTools).not.toContain("read_file");
    expect(compiled.projectRules.some((rule) => rule.id.startsWith("mode-role:"))).toBe(
      true,
    );
  });

  it("compiles ask to read-only tool deny list without edit tools", () => {
    const ask = BUILTIN_MODE_PROFILES.find((profile) => profile.slug === "ask")!;
    const compiled = compileModeProfile(ask);
    expect(compiled.agentMode).toBe("ask");
    expect(compiled.userSafetyRules.denyTools).toContain("apply_patch");
    expect(compiled.userSafetyRules.denyTools).toContain("run_command");
    expect(compiled.userSafetyRules.denyTools).not.toContain("read_file");
  });

  it("loads project catalog and overrides builtins", () => {
    const root = mkdtempSync(join(tmpdir(), "mitii-modes-"));
    dirs.push(root);
    mkdirSync(join(root, ".mitii"), { recursive: true });
    writeFileSync(
      join(root, ".mitii", MODE_CATALOG_FILENAME),
      JSON.stringify({
        schemaVersion: 1,
        active: "docs-only",
        modes: [
          {
            slug: "docs-only",
            name: "Docs only",
            agentMode: "agent",
            toolGroups: ["read", "edit"],
            mutationRelativePathRegex: "\\.md$",
            roleDefinition: "Docs only editor.",
          },
        ],
      }),
      "utf8",
    );
    const loaded = loadModeProfiles(root);
    expect(loaded.activeSlug).toBe("docs-only");
    expect(loaded.active?.name).toBe("Docs only");
    expect(resolveModeProfile(root, "architect")?.source).toBe("builtin");
  });

  it("mergeUserSafetyRules unions deny lists without widening", () => {
    const merged = mergeUserSafetyRules(
      {
        enabled: true,
        denyTools: ["delete_directory"],
        denyCommandPrefixes: ["rm"],
        denyPathScopes: [],
        denyNetworkHosts: [],
        protectedPathGlobs: [".mitii/**"],
      },
      {
        enabled: true,
        denyTools: ["run_command"],
        denyCommandPrefixes: ["sudo"],
        denyPathScopes: [],
        denyNetworkHosts: [],
        protectedPathGlobs: ["AGENTS.md"],
        mutationRelativePathRegex: "\\.md$",
        autoApprove: { write: true, execute: false, mcp: false, network: false, external: false },
      },
    );
    expect(merged.enabled).toBe(true);
    expect(merged.denyTools).toEqual(
      expect.arrayContaining(["delete_directory", "run_command"]),
    );
    expect(merged.denyCommandPrefixes).toEqual(
      expect.arrayContaining(["rm", "sudo"]),
    );
    expect(merged.protectedPathGlobs).toEqual(
      expect.arrayContaining([".mitii/**", "AGENTS.md"]),
    );
    expect(merged.mutationRelativePathRegex).toBe("\\.md$");
    expect(merged.autoApprove?.write).toBe(true);
  });
});
