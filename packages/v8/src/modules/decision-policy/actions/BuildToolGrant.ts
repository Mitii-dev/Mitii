import type { RequestUnderstandingResult } from "../../request-understanding";

import {
  MUTATION_TOOL_IDS,
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
import { DEFAULT_AGENT_READONLY_COMMAND_PREFIXES } from "./BuildVerificationGrant";
import { resolveMutationBudget } from "./ResolveMutationBudget";

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
}): ToolGrantResolution {
  const { mode, route, understanding } = params;
  const reasonCodes: DecisionReasonCode[] = [];
  const pathScopes = resolvePathScopes(understanding);
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
    });

    return {
      toolGrant: {
        maximumWorkspaceEffect: "read",
        allowedTools: [
          ...READ_ONLY_TOOL_IDS,
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
  const risk = understanding.taskAnalysis.risk;
  const defaultApprovalMode =
    risk === "high" || risk === "critical" ? "every_mutation" : "when_required";
  const approvalMode = params.approvalMode ?? defaultApprovalMode;

  if (defaultApprovalMode === "every_mutation") {
    reasonCodes.push("high_risk_approval");
  }
  reasonCodes.push("mutation_execute");

  const mutation = resolveMutationBudget({ understanding });
  reasonCodes.push(...mutation.reasonCodes);

  const network = resolveNetworkAuthority({
    understanding,
    message: params.message,
    allowNetwork: true,
  });

  return {
    toolGrant: {
      maximumWorkspaceEffect: "write",
      allowedTools: [
        ...READ_ONLY_TOOL_IDS,
        ...MUTATION_TOOL_IDS,
        ...network.allowedTools,
      ],
      allowedEffects: [
        "workspace_read",
        "workspace_write",
        "process_execute",
        ...network.allowedEffects,
      ],
      pathScopes,
      commandRules,
      networkHosts: network.networkHosts,
      approvalMode,
      limits: { ...DEFAULT_TOOL_GRANT_LIMITS },
      mutationBudget: mutation.mutationBudget,
    },
    reasonCodes: [...reasonCodes, ...network.reasonCodes],
  };
}

function resolvePathScopes(
  understanding: RequestUnderstandingResult,
): string[] {
  const explicitPaths = understanding.taskAnalysis.targets
    .filter(
      (target) =>
        target.explicit &&
        (target.kind === "file" || target.kind === "folder") &&
        target.value.length > 0,
    )
    .map((target) => target.value);

  if (explicitPaths.length > 0) {
    return explicitPaths;
  }

  return ["."];
}

/**
 * Grant fetch_url / web_search only when the request explicitly references
 * network-worthy intent (docs) or concrete http(s) URLs.
 */
function resolveNetworkAuthority(params: {
  understanding: RequestUnderstandingResult;
  message?: string;
  allowNetwork: boolean;
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
  const docsIntent = intent === "docs" || intent === "question";
  const wantsSearch =
    docsIntent &&
    /\b(search|look up|google|docs?|documentation|reference)\b/i.test(
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
  if (wantsSearch || hosts.length > 0) {
    allowedTools.push("web_search");
  }

  return {
    allowedTools,
    allowedEffects: ["network_access"],
    networkHosts: hosts,
    reasonCodes: [],
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
