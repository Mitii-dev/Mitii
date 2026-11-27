import {
  MUTATION_TOOL_IDS,
  PROCESS_TOOL_IDS,
  READ_ONLY_TOOL_IDS,
} from "../constants";
import type { ToolGrant } from "../contracts";
import {
  DEFAULT_NONE_TOOL_GRANT_LIMITS,
  DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS,
  DEFAULT_TOOL_GRANT_LIMITS,
} from "../defaults";
import { attachUnifiedScopes } from "./AttachUnifiedScopes";
import { DEFAULT_AGENT_READONLY_COMMAND_PREFIXES } from "./BuildVerificationGrant";
import type { GrantProfile } from "./SelectGrantProfile";
import { profileReasonCode } from "./SelectGrantProfile";

export interface CompileGrantFromPlateInput {
  grantProfile: GrantProfile;
  pathScopes: readonly string[];
  mutationPathScopes?: readonly string[];
  /** Hard-caution paths from ScopeVerdict (S2-SCOPE). */
  protectedPathGlobs?: readonly string[];
  mcpServerIds?: readonly string[];
  /** Host approval preset override (safe / guided / pilot). */
  approvalMode?: ToolGrant["approvalMode"];
}

export interface CompileGrantFromPlateResult {
  toolGrant: ToolGrant;
  reasonCodes: string[];
}

/**
 * Compile a ToolGrant from a decision plate profile + ScopeVerdict scopes (S2C).
 * Does not require a full RequestUnderstandingResult — plate is authority.
 */
export function compileGrantFromPlate(
  input: CompileGrantFromPlateInput,
): CompileGrantFromPlateResult {
  const pathScopes =
    input.pathScopes.length > 0 ? [...input.pathScopes] : ["."];
  const reasonCodes = [
    profileReasonCode(input.grantProfile),
    "grant_from_plate",
  ];

  const fence =
    input.mutationPathScopes && input.mutationPathScopes.length > 0
      ? [...input.mutationPathScopes]
      : undefined;
  if (fence) {
    reasonCodes.push("grant_mutation_fence_applied");
  }
  const protectedPathGlobs =
    input.protectedPathGlobs && input.protectedPathGlobs.length > 0
      ? [...input.protectedPathGlobs]
      : undefined;
  if (protectedPathGlobs) {
    reasonCodes.push("grant_protected_paths_applied");
  }

  const wrap = (toolGrant: ToolGrant, codes: string[]) => ({
    toolGrant: attachUnifiedScopes({
      ...toolGrant,
      ...(protectedPathGlobs ? { protectedPathGlobs } : {}),
    }),
    reasonCodes: codes,
  });

  switch (input.grantProfile) {
    case "none":
      return wrap(
        {
          maximumWorkspaceEffect: "none",
          allowedTools: [],
          allowedEffects: [],
          pathScopes,
          approvalMode: "never",
          limits: { ...DEFAULT_NONE_TOOL_GRANT_LIMITS },
        },
        reasonCodes,
      );
    case "network_only":
      return wrap(
        {
          maximumWorkspaceEffect: "read",
          allowedTools: ["web_search", "fetch_url"],
          allowedEffects: ["network_access"],
          pathScopes,
          ...(fence ? { mutationPathScopes: fence } : {}),
          approvalMode: "never",
          limits: { ...DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS },
        },
        reasonCodes,
      );
    case "readonly":
    case "research":
      return wrap(
        {
          maximumWorkspaceEffect: "read",
          allowedTools: [...READ_ONLY_TOOL_IDS],
          allowedEffects: ["workspace_read", "process_execute"],
          pathScopes,
          ...(fence ? { mutationPathScopes: fence } : {}),
          commandRules: [
            {
              prefixes: [...DEFAULT_AGENT_READONLY_COMMAND_PREFIXES],
              allowShellMetacharacters: false,
            },
          ],
          approvalMode: "never",
          limits: { ...DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS },
          ...(input.mcpServerIds?.length
            ? { allowedMcpServerIds: [...input.mcpServerIds] }
            : {}),
        },
        reasonCodes,
      );
    case "agent_execute": {
      const approvalMode = input.approvalMode ?? "when_required";
      return wrap(
        {
          maximumWorkspaceEffect: "write",
          allowedTools: [
            ...READ_ONLY_TOOL_IDS,
            ...MUTATION_TOOL_IDS,
            ...PROCESS_TOOL_IDS,
          ],
          allowedEffects: [
            "workspace_read",
            "workspace_write",
            "process_execute",
          ],
          pathScopes,
          ...(fence ? { mutationPathScopes: fence } : {}),
          commandRules: [
            {
              prefixes: [...DEFAULT_AGENT_READONLY_COMMAND_PREFIXES],
              allowShellMetacharacters: false,
            },
          ],
          approvalMode,
          // Guided (when_required): auto-approve routine file writes; still
          // gate execute / mcp / external via NeedsMutationApproval + skips.
          ...(approvalMode === "when_required"
            ? { approvalSkipCategories: ["write" as const] }
            : {}),
          limits: { ...DEFAULT_TOOL_GRANT_LIMITS },
          ...(input.mcpServerIds?.length
            ? { allowedMcpServerIds: [...input.mcpServerIds] }
            : {}),
        },
        [
          ...reasonCodes,
          ...(fence ? [] : ["grant_mutation_workspace_ceiling"]),
          `grant_approval_${approvalMode}`,
        ],
      );
    }
    default: {
      const _exhaustive: never = input.grantProfile;
      void _exhaustive;
      return wrap(
        {
          maximumWorkspaceEffect: "none",
          allowedTools: [],
          allowedEffects: [],
          pathScopes,
          approvalMode: "never",
          limits: { ...DEFAULT_NONE_TOOL_GRANT_LIMITS },
        },
        [...reasonCodes, "grant_profile_unknown"],
      );
    }
  }
}
