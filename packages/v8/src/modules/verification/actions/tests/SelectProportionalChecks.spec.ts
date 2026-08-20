import { describe, expect, it } from "vitest";

import type { DiscoveredCheckCandidate } from "../../internal/discovery";
import { selectProportionalChecks } from "../SelectProportionalChecks";

const typecheck: DiscoveredCheckCandidate = {
  checkId: "root:typecheck:tsc",
  kind: "typecheck",
  projectId: "root",
  label: "npx tsc --noEmit",
  evidenceSource: "manifest:tsconfig.json",
  languageId: "typescript",
  toolName: "run_readonly_command",
  toolArguments: { argv: ["npx", "tsc", "--noEmit"] },
  argv: ["npx", "tsc", "--noEmit"],
};

const desktopTest: DiscoveredCheckCandidate = {
  checkId: "root:test:desktop:test",
  kind: "test",
  projectId: "root",
  label: "npm desktop:test",
  evidenceSource: "manifest:package.json#scripts.desktop:test",
  languageId: "typescript",
  toolName: "run_readonly_command",
  toolArguments: { argv: ["npm", "run", "desktop:test"] },
  argv: ["npm", "run", "desktop:test"],
};

describe("selectProportionalChecks", () => {
  it("omits WDIO/test scripts unless tests evidence was required", () => {
    const result = selectProportionalChecks({
      candidates: [typecheck, desktopTest],
      verification: {
        required: true,
        minimumEvidence: ["diagnostics", "typecheck", "build"],
        allowUnavailable: true,
      },
      changeScope: "cross_cutting",
    });

    expect(result.selected.map((candidate) => candidate.kind)).toEqual([
      "typecheck",
    ]);
    expect(result.omitted.map((candidate) => candidate.kind)).toEqual(["test"]);
  });

  it("keeps test checks when tests evidence is required", () => {
    const result = selectProportionalChecks({
      candidates: [typecheck, desktopTest],
      verification: {
        required: true,
        minimumEvidence: ["tests"],
        allowUnavailable: true,
      },
      changeScope: "cross_cutting",
    });

    expect(result.selected.map((candidate) => candidate.kind)).toEqual([
      "typecheck",
      "test",
    ]);
  });
});
