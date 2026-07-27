import type { ToolGrant } from "../contracts";
import {
  DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS,
} from "../defaults";
import { READ_ONLY_TOOL_IDS } from "../constants";

/**
 * Package-manager / toolchain prefixes Verification may run via
 * `run_readonly_command`. Intentionally broader than the model-facing agent
 * grant (which stays on git read prefixes).
 */
export const DEFAULT_VERIFICATION_COMMAND_PREFIXES = [
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
  "git status",
  "git diff",
  "git log",
  "git show",
  "git blame",
] as const;

/** Git read prefixes exposed to the model via agent grants. */
export const DEFAULT_AGENT_READONLY_COMMAND_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "git show",
  "git blame",
] as const;

/**
 * Build a ToolGrant for Verification only.
 * Reuses pathScopes/tools from the agent grant but replaces commandRules with
 * verification prefixes so the model cannot gain npm/cargo authority.
 */
export function buildVerificationGrant(base: ToolGrant): ToolGrant {
  const allowedTools = base.allowedTools.filter((tool) =>
    (READ_ONLY_TOOL_IDS as readonly string[]).includes(tool),
  );
  const tools =
    allowedTools.length > 0 ? allowedTools : [...READ_ONLY_TOOL_IDS];

  return {
    maximumWorkspaceEffect: "read",
    allowedTools: tools,
    allowedEffects: ["workspace_read", "process_execute"],
    pathScopes: [...base.pathScopes],
    commandRules: [
      {
        prefixes: [...DEFAULT_VERIFICATION_COMMAND_PREFIXES],
        allowShellMetacharacters: false,
      },
    ],
    networkHosts: [],
    approvalMode: "never",
    limits: {
      ...DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS,
      maxToolCalls: Math.max(
        base.limits.maxToolCalls,
        DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS.maxToolCalls,
      ),
      maxWallTimeMs: Math.max(
        base.limits.maxWallTimeMs,
        DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS.maxWallTimeMs,
      ),
      maxOutputBytes: Math.max(
        base.limits.maxOutputBytes,
        DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS.maxOutputBytes,
      ),
    },
  };
}
