import type { ToolGrant } from "../contracts";
import {
  DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS,
} from "../defaults";
import { READ_ONLY_TOOL_IDS } from "../constants";

/**
 * Shared argv-only toolchain prefixes for diagnosis and verification.
 * Tool Runtime still forbids shell metacharacters and requires exact prefix
 * matches — this is process authority, not a free shell.
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
  "tsc",
  "npx",
] as const;

/**
 * Read-only argv prefixes exposed to the model via agent grants.
 *
 * Coding agents must be able to reproduce build / typecheck / lint / test
 * failures (and inspect git) before deciding what to edit. Keep this aligned
 * with DEFAULT_VERIFICATION_COMMAND_PREFIXES unless Verification needs a
 * strictly wider set.
 */
export const DEFAULT_AGENT_READONLY_COMMAND_PREFIXES = [
  ...DEFAULT_VERIFICATION_COMMAND_PREFIXES,
] as const;

/**
 * Build a ToolGrant for Verification only.
 * Reuses pathScopes/tools from the agent grant and applies verification
 * command prefixes (read-only process execution, never mutation tools).
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
