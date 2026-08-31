import type { RequestUnderstandingResult } from "../../request-understanding";
import type { WindowPolicy } from "../../window-budget";

import {
  MUTATION_TASK_INTENTS,
  MUTATION_TOOL_IDS,
  GITHUB_MUTATION_TOOL_IDS,
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
import { resolveMutationBudget } from "./ResolveMutationBudget";
import { shouldElevateSharedScopeRisk } from "./ClassifySharedScopeRepair";

export interface ToolGrantResolution {
  toolGrant: ToolGrant;
  reasonCodes: DecisionReasonCode[];
}

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
  const readOnlyTools = READ_ONLY_TOOL_IDS.filter(
    (toolId) => toolId !== "analyze_change_impact" || changeImpactAffordable,
  );
  const pathScopes = resolvePathScopes(understanding);
  const mutationPathScopes = resolveMutationPathScopes(
    understanding,
    params.message,
  );
  const commandRules = [
    {
      prefixes: [...DEFAULT_AGENT_READONLY_COMMAND_PREFIXES],
      allowShellMetacharacters: false,
    },
  ];

  if (route === "clarify" || route === "direct_answer") {
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
  }

  if (
    route === "repository_answer" ||
    route === "diagnose" ||
    route === "plan" ||
    mode === "ask" ||
    mode === "plan"
  ) {
    if (route === "diagnose") {
      reasonCodes.push("diagnosis_readonly");
    }
    if (mode === "ask") {
      reasonCodes.push("mode_ask_readonly");
    }
    if (mode === "plan") {
      reasonCodes.push("mode_plan_only");
    }

    const network = resolveNetworkAuthority({
      understanding,
      message: params.message,
      allowNetwork: true,
      allowWebSearch: params.allowWebSearch === true,
    });

    return {
      toolGrant: {
        maximumWorkspaceEffect: "read",
        allowedTools: [
          ...readOnlyTools,
          ...network.allowedTools,
        ],
        // process_execute is required so Tool Runtime can run argv-only
        // read-only commands covered by commandRules; it is not write authority.
        allowedEffects: [
          "workspace_read",
          "process_execute",
          ...network.allowedEffects,
        ],
        pathScopes,
        commandRules,
        networkHosts: network.networkHosts,
        approvalMode: "never",
        limits: { ...DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS },
      },
      reasonCodes: [...reasonCodes, ...network.reasonCodes],
    };
  }

  // execute in agent mode
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
    if (changeImpactAffordable) {
      reasonCodes.push("change_impact_recommended");
    }
  }
  const defaultApprovalMode =
    risk === "high" || risk === "critical" ? "every_mutation" : "when_required";
  const approvalMode = params.approvalMode ?? defaultApprovalMode;

  if (defaultApprovalMode === "every_mutation") {
    reasonCodes.push("high_risk_approval");
  }
  reasonCodes.push("mutation_execute");

  const mutation = resolveMutationBudget({
    understanding,
    windowPolicy: params.windowPolicy,
  });
  reasonCodes.push(...mutation.reasonCodes);
  const processExecution = resolveProcessExecutionAuthority({
    understanding,
    verificationRequired:
      understanding.taskAnalysis.recommendsVerification === true,
  });
  reasonCodes.push(...processExecution.reasonCodes);

  const network = resolveNetworkAuthority({
    understanding,
    message: params.message,
    allowNetwork: true,
    allowWebSearch: params.allowWebSearch === true,
  });

  return {
    toolGrant: {
      maximumWorkspaceEffect: "write",
      allowedTools: [
        ...readOnlyTools,
        ...MUTATION_TOOL_IDS,
        ...GITHUB_MUTATION_TOOL_IDS,
        ...processExecution.allowedTools,
        ...network.allowedTools,
      ],
      allowedEffects: [
        "workspace_read",
        "workspace_write",
        "process_execute",
        "external_write",
        "git_write",
        ...network.allowedEffects,
      ],
      pathScopes,
      ...(mutationPathScopes ? { mutationPathScopes } : {}),
      commandRules: processExecution.commandRules,
      networkHosts: network.networkHosts,
      approvalMode,
      limits: { ...DEFAULT_TOOL_GRANT_LIMITS },
      mutationBudget: mutation.mutationBudget,
    },
    reasonCodes: [...reasonCodes, ...network.reasonCodes],
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

function resolvePathScopes(
  understanding: RequestUnderstandingResult,
): string[] {
  const primaryIntent =
    understanding.intent.classification.primaryTaskIntent;
  if (
    primaryIntent === "dependency" ||
    primaryIntent === "security" ||
    primaryIntent === "audit"
  ) {
    return ["."];
  }

  const { taskAnalysis } = understanding;

  // Discovery-heavy work must keep workspace-wide read access. Narrowing
  // pathScopes to a few chat-mentioned files rejects search_files/glob/list
  // outside those exact paths (seen when prior turns leaked into targets).
  if (
    taskAnalysis.recommendsRepositoryDiscovery ||
    taskAnalysis.scope === "repository" ||
    taskAnalysis.scope === "workspace" ||
    taskAnalysis.scope === "package" ||
    taskAnalysis.scope === "multi_file" ||
    taskAnalysis.scope === "unknown"
  ) {
    return ["."];
  }

  const scopes = new Set<string>();
  for (const target of taskAnalysis.targets) {
    if (!target.explicit || target.value.length === 0) {
      continue;
    }
    if (target.kind === "folder") {
      scopes.add(normalizeScopePath(target.value));
      continue;
    }
    if (target.kind === "file") {
      // File scopes only allow that exact path; use the parent directory so
      // siblings and nearby discovery tools still work.
      scopes.add(parentDirectoryScope(target.value));
    }
  }

  if (scopes.size === 0) {
    return ["."];
  }

  return [...scopes];
}

function resolveMutationPathScopes(
  understanding: RequestUnderstandingResult,
  message?: string,
): string[] | undefined {
  const scopes = new Set<string>();
  for (const target of understanding.taskAnalysis.targets) {
    if (!target.explicit || target.value.length === 0) {
      continue;
    }
    if (target.kind === "folder") {
      scopes.add(normalizeScopePath(target.value));
      continue;
    }
    if (target.kind === "file") {
      scopes.add(parentDirectoryScope(target.value));
    }
  }
  if (message && looksLikeWorkspaceRootMutation(message)) {
    scopes.add(".");
  }
  if (scopes.size === 0) {
    return undefined;
  }
  return [...scopes].sort((left, right) => left.localeCompare(right));
}

/** User asked to create or edit at the repository/workspace root. */
export function looksLikeWorkspaceRootMutation(message: string): boolean {
  return (
    /\b(?:in|at|to)\s+(?:the\s+)?(?:project|repo(?:sitory)?|workspace)\s+root\b/i.test(
      message,
    ) ||
    /\b(?:project|repo(?:sitory)?|workspace)\s+root\b/i.test(message) ||
    /\broot\s+of\s+(?:the\s+)?(?:project|repo(?:sitory)?|workspace)\b/i.test(
      message,
    )
  );
}

function normalizeScopePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "") || ".";
}

function parentDirectoryScope(filePath: string): string {
  const normalized = normalizeScopePath(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

/**
 * Grant fetch_url / web_search only when the request explicitly references
 * network-worthy intent (docs) or concrete http(s) URLs.
 */
function resolveNetworkAuthority(params: {
  understanding: RequestUnderstandingResult;
  message?: string;
  allowNetwork: boolean;
  allowWebSearch: boolean;
}): {
  allowedTools: string[];
  allowedEffects: Array<"network_access">;
  networkHosts: string[];
  reasonCodes: DecisionReasonCode[];
} {
  if (!params.allowNetwork) {
    return {
      allowedTools: [],
      allowedEffects: [],
      networkHosts: [],
      reasonCodes: [],
    };
  }

  const intent = params.understanding.intent.classification.primaryTaskIntent;
  const hosts = extractNetworkHosts(params.message ?? "");
  // Docs/question intent alone is not enough — require concrete hosts or an
  // explicit search ask. Hosts must also allow webSearch for search tools.
  const wantsSearch =
    (intent === "docs" || intent === "question") &&
    /\b(search\s+(?:the\s+)?(?:web|internet|docs?|documentation)|look\s+up|google)\b/i.test(
      params.message ?? "",
    );

  if (hosts.length === 0 && !wantsSearch) {
    return {
      allowedTools: [],
      allowedEffects: [],
      networkHosts: [],
      reasonCodes: [],
    };
  }

  const allowedTools: string[] = [];
  if (hosts.length > 0) {
    allowedTools.push("fetch_url", "fetch_docs");
  }
  // web_search only when host enabled it AND user explicitly asked to search.
  // Presence of a URL alone does not open unrestricted search.
  if (params.allowWebSearch && wantsSearch) {
    allowedTools.push("web_search");
  }

  if (allowedTools.length === 0) {
    return {
      allowedTools: [],
      allowedEffects: [],
      networkHosts: [],
      reasonCodes: [],
    };
  }

  return {
    allowedTools,
    allowedEffects: ["network_access"],
    // Search without hosts keeps an empty allowlist; fetch tools require hosts.
    networkHosts: hosts,
    reasonCodes: ["network_access_granted"],
  };
}

export function extractNetworkHosts(message: string): string[] {
  const hosts = new Set<string>();
  const pattern = /\bhttps?:\/\/([a-z0-9.-]+)(?::\d+)?(?:\/|\b)/gi;
  for (const match of message.matchAll(pattern)) {
    const host = match[1]?.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) {
      continue;
    }
    hosts.add(host);
  }
  return [...hosts].slice(0, 8);
}
