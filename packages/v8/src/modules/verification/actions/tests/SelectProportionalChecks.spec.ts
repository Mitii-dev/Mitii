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

  it("keeps unit test checks when tests evidence is required", () => {
    const unitTest: DiscoveredCheckCandidate = {
      ...desktopTest,
      checkId: "root:test:test:unit",
      label: "npm test:unit",
      evidenceSource: "manifest:package.json#scripts.test:unit",
      toolArguments: { argv: ["npm", "run", "test:unit"] },
      argv: ["npm", "run", "test:unit"],
    };
    const result = selectProportionalChecks({
      candidates: [typecheck, unitTest],
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
    expect(result.selected.map((candidate) => candidate.checkId)).toContain(
      "root:test:test:unit",
    );
  });

  it("omits browser/e2e scripts even when tests evidence is required", () => {
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
    ]);
    expect(result.omitted.map((candidate) => candidate.checkId)).toContain(
      "root:test:desktop:test",
    );
  });

  it("localized scope keeps one typecheck and prefers inferred package over workspace-root", () => {
    const rootTypecheck: DiscoveredCheckCandidate = {
      ...typecheck,
      checkId: "workspace-root:typecheck:typecheck",
      projectId: "workspace-root",
      label: "pnpm typecheck (workspace-root)",
    };
    const packageTypecheck: DiscoveredCheckCandidate = {
      ...typecheck,
      checkId: "inferred:apps/desktop:typecheck:typecheck",
      projectId: "inferred:apps/desktop",
      label: "pnpm typecheck (inferred:apps/desktop)",
    };
    const result = selectProportionalChecks({
      candidates: [rootTypecheck, packageTypecheck],
      verification: {
        required: true,
        minimumEvidence: ["diagnostics", "typecheck"],
        allowUnavailable: false,
      },
      changeScope: "localized",
    });

    expect(result.selected.map((c) => c.checkId)).toEqual([
      "inferred:apps/desktop:typecheck:typecheck",
    ]);
    expect(result.omitted.map((c) => c.checkId)).toContain(
      "workspace-root:typecheck:typecheck",
    );
  });

  it("cross_cutting may still select multiple typechecks across projects", () => {
    const rootTypecheck: DiscoveredCheckCandidate = {
      ...typecheck,
      checkId: "workspace-root:typecheck:typecheck",
      projectId: "workspace-root",
    };
    const packageTypecheck: DiscoveredCheckCandidate = {
      ...typecheck,
      checkId: "inferred:packages/host:typecheck:typecheck",
      projectId: "inferred:packages/host",
    };
    const result = selectProportionalChecks({
      candidates: [rootTypecheck, packageTypecheck],
      verification: {
        required: true,
        minimumEvidence: ["typecheck"],
        allowUnavailable: false,
      },
      changeScope: "cross_cutting",
      maxChecks: 4,
    });

    expect(result.selected.map((c) => c.checkId)).toEqual([
      "inferred:packages/host:typecheck:typecheck",
      "workspace-root:typecheck:typecheck",
    ]);
  });
});
