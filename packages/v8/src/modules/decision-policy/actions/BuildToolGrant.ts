import type { RequestUnderstandingResult } from "../../request-understanding";
import type { WindowPolicy } from "../../window-budget";

import {
  MUTATION_TASK_INTENTS,
  MUTATION_TOOL_IDS,
  GITHUB_MUTATION_TOOL_IDS,
  GIT_MUTATION_TOOL_IDS,
  PROCESS_TOOL_IDS,
  READ_ONLY_TOOL_IDS,
} from "../constants";
import type {
  ApprovalMode,
  DecisionReasonCode,
  ExecutionRoute,
  ToolGrant,
} from "../contracts";
import {
  DEFAULT_NONE_TOOL_GRANT_LIMITS,
  DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS,
  DEFAULT_TOOL_GRANT_LIMITS,
} from "../defaults";
import {
  DEFAULT_AGENT_READONLY_COMMAND_PREFIXES,
  DEFAULT_VERIFICATION_COMMAND_PREFIXES,
} from "./BuildVerificationGrant";
import { looksLikeVcsHistoryRewrite } from "./DetectVcsHistoryRewrite";
import { resolveMutationBudget } from "./ResolveMutationBudget";
import {
  shouldElevateSharedScopeRisk,
  shouldRecommendChangeImpact,
} from "./ClassifySharedScopeRepair";
import { looksLikeCodeReviewRequest } from "./RouteMessageSignals";
import { EXECUTION_ROUTE } from "../constants";
import {
  profileReasonCode,
  selectGrantProfile,
  type ToolGrantResolution,
} from "./SelectGrantProfile";
import {
  resolveMutationPathScopes,
  resolvePathScopes,
} from "./ResolveGrantPathScopes";
import {
  resolveNetworkAuthority,
  type NetworkAuthority,
} from "./ResolveNetworkAuthority";

export {
  GRANT_PROFILES,
  selectGrantProfile,
  type GrantProfile,
  type ToolGrantResolution,
} from "./SelectGrantProfile";
export {
  isExplicitWebSearchAsk,
  needsLiveWebEvidence,
  extractNetworkHosts,
} from "./ResolveNetworkAuthority";
export { looksLikeWorkspaceRootMutation } from "./ResolveGrantPathScopes";

export function buildToolGrant(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  understanding: RequestUnderstandingResult;
  /** Optional raw user message for URL host extraction. */
  message?: string;
  approvalMode?: ApprovalMode;
  /** When false/undefined, never grant web_search (honest hide until SearchPort). */
  allowWebSearch?: boolean;
  windowPolicy?: WindowPolicy;
}): ToolGrantResolution {
  const { mode, route, understanding } = params;
  const reasonCodes: DecisionReasonCode[] = [];
  const changeImpactAffordable =
    params.windowPolicy?.planning.changeImpactAffordable !== false;
  const readOnlyTools = filterReadOnlyTools(changeImpactAffordable);
  const pathScopes = resolvePathScopes(understanding);
  const mutationPathScopes = resolveMutationPathScopes(
    understanding,
    params.message,
  );

  const network = resolveNetworkAuthority({
    understanding,
    message: params.message,
    allowNetwork: true,
    allowWebSearch: params.allowWebSearch === true,
  });

  const grantProfile = selectGrantProfile({
    mode,
    route,
    hasNetworkTools: network.allowedTools.length > 0,
  });
  reasonCodes.push(profileReasonCode(grantProfile));

  appendModeAndRouteReasonCodes({
    mode,
    route,
    message: params.message ?? "",
    reasonCodes,
  });

  switch (grantProfile) {
    case "none":
      return {
        grantProfile,
        reasonCodes,
        toolGrant: buildNoneGrant(pathScopes),
      };
    case "network_only":
      reasonCodes.push(...network.reasonCodes);
      return {
        grantProfile,
        reasonCodes,
        toolGrant: buildNetworkOnlyGrant({
          pathScopes,
          network,
        }),
      };
    case "readonly":
      reasonCodes.push(...network.reasonCodes);
      return {
        grantProfile,
        reasonCodes,
        toolGrant: buildReadonlyGrant({
          readOnlyTools,
          pathScopes,
          network,
        }),
      };
    case "agent_execute":
      return {
        grantProfile,
        ...buildAgentExecuteGrant({
          understanding,
          message: params.message,
          approvalMode: params.approvalMode,
          windowPolicy: params.windowPolicy,
          changeImpactAffordable,
          readOnlyTools,
          pathScopes,
          mutationPathScopes,
          network,
          reasonCodes,
        }),
      };
  }
}

function filterReadOnlyTools(changeImpactAffordable: boolean): string[] {
  return READ_ONLY_TOOL_IDS.filter((toolId) => {
    if (
      toolId === "analyze_change_impact" ||
      toolId === "plan_check_change_impact"
    ) {
      return changeImpactAffordable;
    }
    return true;
  });
}

function appendModeAndRouteReasonCodes(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  message: string;
  reasonCodes: DecisionReasonCode[];
}): void {
  if (params.route === EXECUTION_ROUTE.DIAGNOSE) {
    params.reasonCodes.push("diagnosis_readonly");
    if (looksLikeCodeReviewRequest(params.message)) {
      params.reasonCodes.push("review_pipeline_required");
      params.reasonCodes.push("review_findings_structured");
    }
  }
  if (params.mode === "ask") {
    params.reasonCodes.push("mode_ask_readonly");
  }
  if (params.mode === "plan") {
    params.reasonCodes.push("mode_plan_only");
  }
}

function buildNoneGrant(pathScopes: string[]): ToolGrant {
  return {
    maximumWorkspaceEffect: "none",
    allowedTools: [],
    allowedEffects: [],
    pathScopes,
    approvalMode: "never",
    limits: { ...DEFAULT_NONE_TOOL_GRANT_LIMITS },
  };
}

function buildNetworkOnlyGrant(params: {
  pathScopes: string[];
  network: NetworkAuthority;
}): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: [...params.network.allowedTools],
    allowedEffects: [...params.network.allowedEffects],
    pathScopes: params.pathScopes,
    networkHosts: params.network.networkHosts,
    approvalMode: "never",
    limits: { ...DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS },
  };
}

function buildReadonlyGrant(params: {
  readOnlyTools: string[];
  pathScopes: string[];
  network: NetworkAuthority;
}): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: [...params.readOnlyTools, ...params.network.allowedTools],
    // process_execute enables argv-only run_readonly_command — not write.
    allowedEffects: [
      "workspace_read",
      "process_execute",
      ...params.network.allowedEffects,
    ],
    pathScopes: params.pathScopes,
    commandRules: [
      {
        prefixes: [...DEFAULT_AGENT_READONLY_COMMAND_PREFIXES],
        allowShellMetacharacters: false,
      },
    ],
    networkHosts: params.network.networkHosts,
    approvalMode: "never",
    limits: { ...DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS },
  };
}

function buildAgentExecuteGrant(params: {
  understanding: RequestUnderstandingResult;
  message?: string;
  approvalMode?: ApprovalMode;
  windowPolicy?: WindowPolicy;
  changeImpactAffordable: boolean;
  readOnlyTools: string[];
  pathScopes: string[];
  mutationPathScopes: string[] | undefined;
  network: NetworkAuthority;
  reasonCodes: DecisionReasonCode[];
}): Omit<ToolGrantResolution, "grantProfile"> {
  const { understanding, reasonCodes } = params;
  let risk = understanding.taskAnalysis.risk;
  if (
    shouldElevateSharedScopeRisk({
      primaryTaskIntent: understanding.intent.classification.primaryTaskIntent,
      taskAnalysis: understanding.taskAnalysis,
      message: params.message ?? "",
    })
  ) {
    risk = "medium";
    reasonCodes.push("shared_scope_risk_elevated");
  }
  if (
    params.changeImpactAffordable &&
    shouldRecommendChangeImpact({
      route: "execute",
      primaryTaskIntent: understanding.intent.classification.primaryTaskIntent,
      taskAnalysis: understanding.taskAnalysis,
      message: params.message ?? "",
    })
  ) {
    reasonCodes.push("change_impact_recommended");
  }

  const defaultApprovalMode =
    risk === "high" || risk === "critical" ? "every_mutation" : "when_required";
  const approvalMode = params.approvalMode ?? defaultApprovalMode;
  if (defaultApprovalMode === "every_mutation") {
    reasonCodes.push("high_risk_approval");
  }
  reasonCodes.push("mutation_execute");

  if (looksLikeVcsHistoryRewrite(params.message ?? "")) {
    reasonCodes.push("vcs_history_rewrite");
  }

  const mutation = resolveMutationBudget({
    understanding,
    windowPolicy: params.windowPolicy,
    message: params.message,
  });
  reasonCodes.push(...mutation.reasonCodes);

  const processExecution = resolveProcessExecutionAuthority({
    understanding,
    verificationRequired:
      understanding.taskAnalysis.recommendsVerification === true,
  });
  reasonCodes.push(...processExecution.reasonCodes);
  reasonCodes.push(...params.network.reasonCodes);

  // Full-access (`approvalMode: never`): workspace-wide read discovery;
  // keep narrow mutationPathScopes from explicit targets.
  const writePathScopes = approvalMode === "never" ? ["."] : params.pathScopes;

  return {
    reasonCodes,
    toolGrant: {
      maximumWorkspaceEffect: "write",
      allowedTools: [
        ...params.readOnlyTools,
        ...MUTATION_TOOL_IDS,
        ...GITHUB_MUTATION_TOOL_IDS,
        ...GIT_MUTATION_TOOL_IDS,
        ...processExecution.allowedTools,
        ...params.network.allowedTools,
      ],
      allowedEffects: [
        "workspace_read",
        "workspace_write",
        "process_execute",
        "external_write",
        "git_write",
        ...params.network.allowedEffects,
      ],
      pathScopes: writePathScopes,
      ...(params.mutationPathScopes
        ? { mutationPathScopes: params.mutationPathScopes }
        : {}),
      commandRules: processExecution.commandRules,
      networkHosts: params.network.networkHosts,
      approvalMode,
      limits: { ...DEFAULT_TOOL_GRANT_LIMITS },
      mutationBudget: mutation.mutationBudget,
    },
  };
}

function resolveProcessExecutionAuthority(params: {
  understanding: RequestUnderstandingResult;
  verificationRequired: boolean;
}): {
  allowedTools: string[];
  commandRules: ToolGrant["commandRules"];
  reasonCodes: DecisionReasonCode[];
} {
  const primaryIntent =
    params.understanding.intent.classification.primaryTaskIntent;
  const mutationIntent = (MUTATION_TASK_INTENTS as readonly string[]).includes(
    primaryIntent,
  );

  if (!mutationIntent && !params.verificationRequired) {
    return {
      allowedTools: [],
      commandRules: [
        {
          prefixes: [...DEFAULT_AGENT_READONLY_COMMAND_PREFIXES],
          allowShellMetacharacters: false,
        },
      ],
      reasonCodes: [],
    };
  }

  return {
    allowedTools: [...PROCESS_TOOL_IDS],
    commandRules: [
      {
        prefixes: [...DEFAULT_VERIFICATION_COMMAND_PREFIXES],
        allowShellMetacharacters: false,
      },
    ],
    reasonCodes: ["process_execution_granted"],
  };
}
