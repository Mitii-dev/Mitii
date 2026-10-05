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
import { looksLikeCodeReviewRequest } from "./ResolveRoute";

/**
 * Discrete grant profiles. Mode + route select exactly one; layers then add
 * network / process / approval / scopes. Ask/plan never select agent_execute.
 *
 * | Profile        | Max effect | apply_patch? |
 * |----------------|------------|--------------|
 * | none           | none       | no           |
 * | network_only   | read       | no           |
 * | readonly       | read       | no           |
 * | agent_execute  | write      | yes          |
 */
export const GRANT_PROFILES = [
  "none",
  "network_only",
  "readonly",
  "agent_execute",
] as const;

export type GrantProfile = (typeof GRANT_PROFILES)[number];

export interface ToolGrantResolution {
  toolGrant: ToolGrant;
  reasonCodes: DecisionReasonCode[];
  /** Selected profile — debug / decision_made honesty. */
  grantProfile: GrantProfile;
}

/**
 * Mode seal + route → grant profile.
 * Agent mode alone is not enough for write: only agent + execute → agent_execute.
 */
export function selectGrantProfile(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  /** When true, direct_answer may become network_only instead of none. */
  hasNetworkTools: boolean;
}): GrantProfile {
  const { mode, route, hasNetworkTools } = params;

  if (route === "clarify") {
    return "none";
  }

  // Ask / plan are hard seals: never agent_execute regardless of route.
  if (mode === "ask" || mode === "plan") {
    if (route === "direct_answer") {
      return hasNetworkTools ? "network_only" : "none";
    }
    return "readonly";
  }

  // Agent mode
  if (route === "direct_answer") {
    return hasNetworkTools ? "network_only" : "none";
  }
  if (route === "execute") {
    return "agent_execute";
  }
  // diagnose | repository_answer | plan
  return "readonly";
}

function profileReasonCode(profile: GrantProfile): DecisionReasonCode {
  switch (profile) {
    case "none":
      return "grant_profile_none";
    case "network_only":
      return "grant_profile_network_only";
    case "readonly":
      return "grant_profile_readonly";
    case "agent_execute":
      return "grant_profile_agent_execute";
  }
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
  return READ_ONLY_TOOL_IDS.filter(
    (toolId) => toolId !== "analyze_change_impact" || changeImpactAffordable,
  );
}

function appendModeAndRouteReasonCodes(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  message: string;
  reasonCodes: DecisionReasonCode[];
}): void {
  if (params.route === "diagnose") {
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

  // Discovery-heavy / wide scope: keep workspace-wide read access.
  // Pinned folders are focus hints only — they do not fence workspace reads.
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

  // Localized work: only *explicit* folder/file mentions narrow read scopes.
  // Implicit artifact / UI pins stay workspace-wide so the agent can still
  // read elsewhere in the workspace (and ask before leaving it).
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
    if (target.value.length === 0) {
      continue;
    }
    // Explicit folder/file mentions only. Implicit UI pins are focus, not a
    // hard mutation fence — workspace remains the default write ceiling.
    if (!target.explicit) {
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
  let normalized =
    value.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "") || ".";
  // Same CI rewrite as tool-runtime: never grant a parallel `github/` tree.
  if (/^github\//i.test(normalized) || normalized === "github") {
    normalized =
      normalized === "github"
        ? ".github"
        : `.github/${normalized.slice("github/".length)}`;
  }
  return normalized;
}

/** Intents that may honestly need live web evidence when SearchPort exists. */
const LIVE_WEB_EVIDENCE_INTENTS = new Set([
  "docs",
  "question",
  "security",
  "dependency",
]);

/** True when the user message explicitly asks for a web/internet search. */
export function isExplicitWebSearchAsk(
  message: string,
  primaryTaskIntent?: RequestUnderstandingResult["intent"]["classification"]["primaryTaskIntent"],
): boolean {
  const intent = primaryTaskIntent ?? "question";
  if (!LIVE_WEB_EVIDENCE_INTENTS.has(intent)) {
    return false;
  }
  return (
    /\b(search\s+(?:the\s+)?(?:web|internet|docs?|documentation)|look\s+up|google)\b/i.test(
      message,
    ) ||
    /\b(?:check|find|search|look(?:\s+up)?)\b[\s\w,-]{0,48}\bonline\b/i.test(
      message,
    ) ||
    /\b(?:on\s+the\s+(?:web|internet)|search\s+online)\b/i.test(message)
  );
}

/**
 * External product / vendor / compatibility / “latest” facts that should not
 * be answered from model memory alone when SearchPort is available.
 */
export function needsLiveWebEvidence(
  message: string,
  primaryTaskIntent?: RequestUnderstandingResult["intent"]["classification"]["primaryTaskIntent"],
): boolean {
  const intent = primaryTaskIntent ?? "question";
  if (!LIVE_WEB_EVIDENCE_INTENTS.has(intent)) {
    return false;
  }
  if (
    /\b(?:this\s+(?:file|function|class|module|repo|code)|in\s+(?:the\s+)?(?:codebase|workspace|repository)|src\/|[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java))\b/i.test(
      message,
    )
  ) {
    return false;
  }
  if (
    (intent === "security" || intent === "dependency") &&
    /\b(?:vulnerabilit(?:y|ies)|cves?|advisories?|ghsa|nvd|osv)\b/i.test(
      message,
    ) &&
    /\b(?:online|web|internet|latest|known|published|advisory|advisories)\b/i.test(
      message,
    )
  ) {
    return true;
  }
  if (intent !== "docs" && intent !== "question") {
    return false;
  }
  return (
    /\b(?:compatible|compatibility|compat)\b/i.test(message) ||
    /\b(?:driver|firmware|datasheet|sku)\b/i.test(message) ||
    /\b(?:download|installer)\b/i.test(message) ||
    /\b(?:latest|current)\s+(?:version|release|software|driver|firmware)\b/i.test(
      message,
    ) ||
    /\b(?:software|driver)\s+(?:for|compatible\s+with)\b/i.test(message) ||
    (/\b(?:windows\s*(?:10|11)|macos|linux)\b/i.test(message) &&
      /\b(?:printer|scanner|device|hardware|zebra|epson|brother|hp)\b/i.test(
        message,
      )) ||
    /\b(?:which|what)\s+(?:software|driver|version|release)\b/i.test(message) ||
    /\b(?:vendor|oem)\s+(?:docs?|documentation|support)\b/i.test(message) ||
    (/\b[A-Z]{1,5}[- ]?\d{2,5}\b/.test(message) &&
      /\b(?:printer|scanner|device|software|driver|compatible)\b/i.test(message))
  );
}

function parentDirectoryScope(filePath: string): string {
  const normalized = normalizeScopePath(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

interface NetworkAuthority {
  allowedTools: string[];
  allowedEffects: Array<"network_access">;
  networkHosts: string[];
  reasonCodes: DecisionReasonCode[];
}

/**
 * Grant fetch_url / web_search when the request has concrete http(s) URLs,
 * an explicit search ask, or live-web evidence needs.
 */
function resolveNetworkAuthority(params: {
  understanding: RequestUnderstandingResult;
  message?: string;
  allowNetwork: boolean;
  allowWebSearch: boolean;
}): NetworkAuthority {
  if (!params.allowNetwork) {
    return {
      allowedTools: [],
      allowedEffects: [],
      networkHosts: [],
      reasonCodes: [],
    };
  }

  const intent = params.understanding.intent.classification.primaryTaskIntent;
  const message = params.message ?? "";
  const hosts = extractNetworkHosts(message);
  const wantsSearch =
    isExplicitWebSearchAsk(message, intent) ||
    needsLiveWebEvidence(message, intent);

  if (hosts.length === 0 && !wantsSearch) {
    return {
      allowedTools: [],
      allowedEffects: [],
      networkHosts: [],
      reasonCodes: [],
    };
  }

  const allowedTools: string[] = [];
  if (hosts.length > 0 || (params.allowWebSearch && wantsSearch)) {
    allowedTools.push("fetch_url", "fetch_docs");
  }
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
