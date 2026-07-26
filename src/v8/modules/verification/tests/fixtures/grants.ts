import type { ToolGrant } from "../../../decision-policy";
import { READ_ONLY_TOOL_IDS } from "../../../tool-runtime";

import type { VerificationInput } from "../../contracts";

export function createVerificationGrant(
  overrides: Partial<ToolGrant> = {},
): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: [...READ_ONLY_TOOL_IDS],
    allowedEffects: ["workspace_read", "process_execute"],
    pathScopes: ["."],
    commandRules: [
      {
        prefixes: [
          "npm",
          "pnpm",
          "yarn",
          "bun",
          "pytest",
          "mypy",
          "ruff",
          "go",
          "cargo",
          "mvn",
          "./mvnw",
          "gradle",
          "./gradlew",
          "dotnet",
          "cmake",
          "ctest",
          "make",
          "bundle",
          "composer",
          "swift",
        ],
        allowShellMetacharacters: false,
      },
    ],
    networkHosts: [],
    approvalMode: "never",
    limits: {
      maxToolCalls: 32,
      maxWallTimeMs: 120_000,
      maxOutputBytes: 256_000,
      maxConcurrentTools: 1,
    },
    ...overrides,
  };
}

export function baseVerificationInput(
  overrides: Partial<VerificationInput> = {},
): VerificationInput {
  return {
    schemaVersion: 1,
    workspaceRoot: "/workspace",
    pinnedState: {
      workspaceId: "ws-1",
      stateToken: "state-token-1",
    },
    changedFiles: ["src/app.ts"],
    projects: [
      {
        projectId: "root",
        rootPath: ".",
        primaryLanguageId: "typescript",
        manifestPaths: ["package.json"],
      },
    ],
    verification: {
      required: true,
      minimumEvidence: ["typecheck", "tests"],
      allowUnavailable: false,
    },
    grant: createVerificationGrant(),
    changeScope: "localized",
    stateReadiness: "ready",
    ...overrides,
  };
}
