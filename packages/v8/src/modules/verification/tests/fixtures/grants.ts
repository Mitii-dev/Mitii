import type { ToolGrant } from "../../../decision-policy";
import {
  DEFAULT_VERIFICATION_COMMAND_PREFIXES,
  READ_ONLY_TOOL_IDS,
  buildVerificationGrant,
} from "../../../decision-policy";

import type { VerificationInput } from "../../contracts";

export function createVerificationGrant(
  overrides: Partial<ToolGrant> = {},
): ToolGrant {
  const base = buildVerificationGrant({
    maximumWorkspaceEffect: "read",
    allowedTools: [...READ_ONLY_TOOL_IDS],
    allowedEffects: ["workspace_read", "process_execute"],
    pathScopes: ["."],
    commandRules: [
      {
        prefixes: ["git status"],
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
  });

  return {
    ...base,
    commandRules: [
      {
        prefixes: [...DEFAULT_VERIFICATION_COMMAND_PREFIXES],
        allowShellMetacharacters: false,
      },
    ],
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
