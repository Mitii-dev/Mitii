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
import { DEFAULT_AGENT_READONLY_COMMAND_PREFIXES } from "./BuildVerificationGrant";
import type { GrantProfile } from "./SelectGrantProfile";
import { profileReasonCode } from "./SelectGrantProfile";

export interface CompileGrantFromPlateInput {
  grantProfile: GrantProfile;
  pathScopes: readonly string[];
  mutationPathScopes?: readonly string[];
  mcpServerIds?: readonly string[];
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

  switch (input.grantProfile) {
    case "none":
      return {
        toolGrant: {
          maximumWorkspaceEffect: "none",
          allowedTools: [],
          allowedEffects: [],
          pathScopes,
          approvalMode: "never",
          limits: { ...DEFAULT_NONE_TOOL_GRANT_LIMITS },
        },
        reasonCodes,
      };
    case "network_only":
      return {
        toolGrant: {
          maximumWorkspaceEffect: "read",
          allowedTools: ["web_search", "fetch_url"],
          allowedEffects: ["network_access"],
          pathScopes,
          ...(fence ? { mutationPathScopes: fence } : {}),
          approvalMode: "never",
          limits: { ...DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS },
        },
        reasonCodes,
      };
    case "readonly":
    case "research":
      return {
        toolGrant: {
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
      };
    case "agent_execute":
      return {
        toolGrant: {
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
          approvalMode: "when_required",
          limits: { ...DEFAULT_TOOL_GRANT_LIMITS },
          ...(input.mcpServerIds?.length
            ? { allowedMcpServerIds: [...input.mcpServerIds] }
            : {}),
        },
        reasonCodes: [
          ...reasonCodes,
          ...(fence ? [] : ["grant_mutation_workspace_ceiling"]),
        ],
      };
    default: {
      const _exhaustive: never = input.grantProfile;
      void _exhaustive;
      return {
        toolGrant: {
          maximumWorkspaceEffect: "none",
          allowedTools: [],
          allowedEffects: [],
          pathScopes,
          approvalMode: "never",
          limits: { ...DEFAULT_NONE_TOOL_GRANT_LIMITS },
        },
        reasonCodes: [...reasonCodes, "grant_profile_unknown"],
      };
    }
  }
}
