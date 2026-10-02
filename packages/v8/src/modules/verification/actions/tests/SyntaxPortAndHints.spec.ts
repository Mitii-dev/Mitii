import { describe, expect, it } from "vitest";

import { InMemoryManifestReader } from "../..";
import { discoverApplicableChecks } from "../DiscoverApplicableChecks";
import { SYNTAX_PORT_EVIDENCE } from "../../contracts";
import { extractScriptHints } from "../../internal/readVerificationScriptHints";
import { selectProportionalChecks } from "../SelectProportionalChecks";
import type { DiscoveredCheckCandidate } from "../../internal/discovery";

describe("discoverApplicableChecks — syntax port", () => {
  it("emits port:syntax and suppresses command syntax when the port is available", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({ name: "app" }),
    });

    const withPort = await discoverApplicableChecks({
      projects: [
        {
          projectId: "root",
          rootPath: ".",
          primaryLanguageId: "python",
          manifestPaths: [],
        },
      ],
      changeScope: "localized",
      changedFiles: ["app.py"],
      manifests,
      syntaxPortAvailable: true,
    });

    expect(
      withPort.candidates.some(
        (c) => c.evidenceSource === SYNTAX_PORT_EVIDENCE,
      ),
    ).toBe(true);
    expect(
      withPort.candidates.some(
        (c) =>
          c.kind === "syntax" && c.evidenceSource !== SYNTAX_PORT_EVIDENCE,
      ),
    ).toBe(false);
  });

  it("returns soft scriptHints from AGENTS.md without inventing checks", async () => {
    const manifests = new InMemoryManifestReader({
      "AGENTS.md": "Run `pnpm verify:unit` and npm run lint before PRs.",
      "package.json": JSON.stringify({
        name: "app",
        scripts: { lint: "eslint .", typecheck: "tsc -b" },
      }),
    });

    const result = await discoverApplicableChecks({
      projects: [],
      changeScope: "module",
      changedFiles: ["src/a.ts"],
      manifests,
    });

    expect(result.scriptHints).toEqual(
      expect.arrayContaining(["verify:unit", "lint"]),
    );
    expect(
      result.candidates.every((c) => c.evidenceSource !== "agents.md"),
    ).toBe(true);
  });
});

describe("extractScriptHints", () => {
  it("extracts package-manager scripts and backtick verify tokens", () => {
    expect(
      extractScriptHints(
        "Prefer `test:unit` and pnpm run typecheck. Also verify:ci.",
      ),
    ).toEqual(
      expect.arrayContaining(["test:unit", "typecheck", "verify:ci"]),
    );
  });
});

describe("selectProportionalChecks — scriptHints", () => {
  it("prefers candidates whose label/argv match AGENTS.md hints", () => {
    const unit: DiscoveredCheckCandidate = {
      checkId: "root:test:test:unit",
      kind: "test",
      projectId: "root",
      label: "npm test:unit",
      evidenceSource: "manifest:package.json#scripts.test:unit",
      languageId: "typescript",
      toolName: "run_readonly_command",
      toolArguments: { argv: ["npm", "run", "test:unit"] },
      argv: ["npm", "run", "test:unit"],
    };
    const integration: DiscoveredCheckCandidate = {
      checkId: "root:test:test:integration",
      kind: "test",
      projectId: "root",
      label: "npm test:integration",
      evidenceSource: "manifest:package.json#scripts.test:integration",
      languageId: "typescript",
      toolName: "run_readonly_command",
      toolArguments: { argv: ["npm", "run", "test:integration"] },
      argv: ["npm", "run", "test:integration"],
    };

    const result = selectProportionalChecks({
      candidates: [integration, unit],
      verification: {
        required: true,
        minimumEvidence: ["tests"],
        allowUnavailable: true,
      },
      changeScope: "cross_cutting",
      maxChecks: 1,
      scriptHints: ["test:unit"],
    });

    // Required `tests` evidence is not truncated by maxChecks; hint ranking
    // must still put the AGENTS.md-preferred script first.
    expect(result.selected[0]?.checkId).toBe("root:test:test:unit");
    expect(result.selected.map((c) => c.checkId)).toContain(
      "root:test:test:unit",
    );
  });
});
