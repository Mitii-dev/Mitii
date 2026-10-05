import { describe, expect, it } from "vitest";

import { InMemoryManifestReader } from "../..";
import { discoverApplicableChecks } from "../DiscoverApplicableChecks";
import {
  NODE_MODULE_LOAD_EVIDENCE,
  SYNTAX_PORT_EVIDENCE,
} from "../../contracts";
import { extractScriptHints } from "../../internal/readVerificationScriptHints";
import {
  selectProportionalChecks,
  syntaxEvidenceRank,
} from "../SelectProportionalChecks";
import type { DiscoveredCheckCandidate } from "../../internal/discovery";

describe("discoverApplicableChecks — syntax port", () => {
  it("emits port:syntax and suppresses parse-only command syntax when the port is available", async () => {
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
          c.kind === "syntax" &&
          c.evidenceSource !== SYNTAX_PORT_EVIDENCE &&
          c.evidenceSource !== NODE_MODULE_LOAD_EVIDENCE,
      ),
    ).toBe(false);
  });

  it("keeps Node module-load syntax alongside the tree-sitter port", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({ name: "app", type: "module" }),
    });

    const withPort = await discoverApplicableChecks({
      projects: [
        {
          projectId: "root",
          rootPath: ".",
          primaryLanguageId: "javascript",
          ecosystemId: "node",
          manifestPaths: ["package.json"],
        },
      ],
      changeScope: "localized",
      changedFiles: ["src/index.js"],
      manifests,
      syntaxPortAvailable: true,
    });

    expect(
      withPort.candidates.some(
        (c) => c.evidenceSource === NODE_MODULE_LOAD_EVIDENCE,
      ),
    ).toBe(true);
    expect(
      withPort.candidates.some(
        (c) => c.evidenceSource === SYNTAX_PORT_EVIDENCE,
      ),
    ).toBe(true);
  });

  it("selects module-load over tree-sitter for the single localized syntax slot", () => {
    const moduleLoad: DiscoveredCheckCandidate = {
      checkId: "root:syntax:module_load",
      kind: "syntax",
      projectId: "root",
      label: "node --import",
      evidenceSource: NODE_MODULE_LOAD_EVIDENCE,
      languageId: "javascript",
      toolName: "run_readonly_command",
      toolArguments: {
        argv: ["node", "--import", "./src/index.js", "-e", "void 0"],
      },
      argv: ["node", "--import", "./src/index.js", "-e", "void 0"],
    };
    const portSyntax: DiscoveredCheckCandidate = {
      checkId: "syntax:port",
      kind: "syntax",
      label: "Tree-sitter syntax check",
      evidenceSource: SYNTAX_PORT_EVIDENCE,
      languageId: "unknown",
      toolName: "run_readonly_command",
      toolArguments: {},
    };

    expect(syntaxEvidenceRank(moduleLoad)).toBeLessThan(
      syntaxEvidenceRank(portSyntax),
    );

    const result = selectProportionalChecks({
      candidates: [portSyntax, moduleLoad],
      verification: {
        required: true,
        minimumEvidence: [],
        allowUnavailable: true,
      },
      changeScope: "localized",
      maxChecks: 4,
    });

    expect(result.selected.map((c) => c.checkId)).toContain(
      "root:syntax:module_load",
    );
    expect(result.selected.map((c) => c.checkId)).not.toContain("syntax:port");
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
