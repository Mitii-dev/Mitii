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

  it("omits sibling package tests when only apps/vscode changed", () => {
    const vscodeTest: DiscoveredCheckCandidate = {
      ...desktopTest,
      checkId: "inferred:apps/vscode:test:test",
      projectId: "inferred:apps/vscode",
      label: "pnpm test (apps/vscode)",
      evidenceSource: "manifest:apps/vscode/package.json#scripts.test",
      toolArguments: { argv: ["pnpm", "--dir", "apps/vscode", "run", "test"] },
      argv: ["pnpm", "--dir", "apps/vscode", "run", "test"],
    };
    const v8Test: DiscoveredCheckCandidate = {
      ...desktopTest,
      checkId: "inferred:packages/v8:test:test",
      projectId: "inferred:packages/v8",
      label: "pnpm test (packages/v8)",
      evidenceSource: "manifest:packages/v8/package.json#scripts.test",
      toolArguments: { argv: ["pnpm", "--dir", "packages/v8", "run", "test"] },
      argv: ["pnpm", "--dir", "packages/v8", "run", "test"],
    };
    const result = selectProportionalChecks({
      candidates: [v8Test, vscodeTest, typecheck],
      verification: {
        required: true,
        minimumEvidence: ["tests"],
        allowUnavailable: true,
      },
      changeScope: "localized",
      changedFiles: ["apps/vscode/src/settings/paste.ts"],
    });

    expect(result.selected.map((c) => c.checkId)).toContain(
      "inferred:apps/vscode:test:test",
    );
    expect(result.selected.map((c) => c.checkId)).not.toContain(
      "inferred:packages/v8:test:test",
    );
    expect(result.omitted.map((c) => c.checkId)).toContain(
      "inferred:packages/v8:test:test",
    );
  });

  it("never selects packages/v8:test for a vscode paste when tests were not requested", () => {
    const v8Test: DiscoveredCheckCandidate = {
      ...desktopTest,
      checkId: "inferred:packages/v8:test:test",
      projectId: "inferred:packages/v8",
      label: "pnpm test (packages/v8)",
      evidenceSource: "manifest:packages/v8/package.json#scripts.test",
      argv: ["pnpm", "--dir", "packages/v8", "run", "test"],
    };
    const vscodeTypecheck: DiscoveredCheckCandidate = {
      ...typecheck,
      checkId: "inferred:apps/vscode:typecheck:typecheck",
      projectId: "inferred:apps/vscode",
      label: "pnpm typecheck (apps/vscode)",
    };
    const result = selectProportionalChecks({
      candidates: [v8Test, vscodeTypecheck],
      verification: {
        required: true,
        minimumEvidence: ["diagnostics", "typecheck"],
        allowUnavailable: false,
      },
      changeScope: "localized",
      changedFiles: ["apps/vscode/package.json"],
    });

    expect(result.selected.map((c) => c.checkId)).toEqual([
      "inferred:apps/vscode:typecheck:typecheck",
    ]);
    expect(result.omitted.map((c) => c.checkId)).toContain(
      "inferred:packages/v8:test:test",
    );
  });

  it("allows packages/v8:test only when that package was edited and tests are required", () => {
    const v8Test: DiscoveredCheckCandidate = {
      ...desktopTest,
      checkId: "inferred:packages/v8:test:test",
      projectId: "inferred:packages/v8",
      label: "pnpm test (packages/v8)",
      evidenceSource: "manifest:packages/v8/package.json#scripts.test",
      argv: ["pnpm", "--dir", "packages/v8", "run", "test"],
    };
    const result = selectProportionalChecks({
      candidates: [v8Test, typecheck],
      verification: {
        required: true,
        minimumEvidence: ["tests"],
        allowUnavailable: true,
      },
      changeScope: "localized",
      changedFiles: ["packages/v8/src/modules/verification/pipeline/VerificationPipeline.ts"],
    });

    expect(result.selected.map((c) => c.checkId)).toContain(
      "inferred:packages/v8:test:test",
    );
  });

  it("localized omits sibling package typecheck when apps/vscode was the only edit", () => {
    const vscodeTypecheck: DiscoveredCheckCandidate = {
      ...typecheck,
      checkId: "inferred:apps/vscode:typecheck:typecheck",
      projectId: "inferred:apps/vscode",
    };
    const v8Typecheck: DiscoveredCheckCandidate = {
      ...typecheck,
      checkId: "inferred:packages/v8:typecheck:typecheck",
      projectId: "inferred:packages/v8",
    };
    const result = selectProportionalChecks({
      candidates: [v8Typecheck, vscodeTypecheck],
      verification: {
        required: true,
        minimumEvidence: ["typecheck"],
        allowUnavailable: false,
      },
      changeScope: "localized",
      changedFiles: ["apps/vscode/src/extension.ts"],
    });

    expect(result.selected.map((c) => c.checkId)).toEqual([
      "inferred:apps/vscode:typecheck:typecheck",
    ]);
    expect(result.omitted.map((c) => c.checkId)).toContain(
      "inferred:packages/v8:typecheck:typecheck",
    );
  });
});
