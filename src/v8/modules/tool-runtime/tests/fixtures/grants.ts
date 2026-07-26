import type { ToolGrant } from "../../../decision-policy";
import { READ_ONLY_TOOL_IDS } from "../../constants";

export function createReadOnlyGrant(
  overrides: Partial<ToolGrant> = {},
): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: [...READ_ONLY_TOOL_IDS],
    allowedEffects: ["workspace_read", "process_execute"],
    pathScopes: ["."],
    commandRules: [
      {
        prefixes: ["git status", "git diff", "git log"],
        allowShellMetacharacters: false,
      },
    ],
    networkHosts: [],
    approvalMode: "never",
    limits: {
      maxToolCalls: 24,
      maxWallTimeMs: 90_000,
      maxOutputBytes: 256_000,
      maxConcurrentTools: 1,
    },
    ...overrides,
  };
}
