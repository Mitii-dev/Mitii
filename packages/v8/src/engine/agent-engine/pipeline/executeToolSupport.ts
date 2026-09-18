import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import {
  toolGrantsEquivalent,
} from "../../../modules/decision-policy";
import type {
  ModelMessage,
} from "../../../modules/model-gateway";
import type {
  ProjectDescriptor,
} from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import { resolveWindowBudgetBand } from "../../../modules/window-budget";
import type {
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import { SKILLS_SCHEMA_VERSION } from "../../../modules/skills";
import type { ToolResult } from "../../tool-runtime";

import {
  mapUnderstandingToSkillEvidence,
  formatSkillPromptContent,
  buildSkillsReadyEvent,
} from "../actions";
import type {
  AgentReasonCode,
  RunEvent,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import {
  DEFAULT_MUTATION_TOOL_DEFINITIONS,
} from "../policy";

import type { AgentEngineRuntime } from "./runtime";

export const DEFAULT_MUTATING_TOOL_NAMES = new Set(
  DEFAULT_MUTATION_TOOL_DEFINITIONS.map((tool) => tool.name),
);

export function safeJsonParse(value: string): unknown {
  try {
    return value.trim().length > 0 ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

export function toolCompletionDiagnostics(
  result: ToolResult,
): Partial<Extract<RunEvent, { type: "tool_completed" }>> {
  const warnings = result.warnings
    .map((warning) => truncateForLogField(warning, 500))
    .filter((warning) => warning.length > 0)
    .slice(0, 5);
  const outputPreview = result.audit.outputPreview
    ? truncateForLogField(result.audit.outputPreview, 1_000)
    : undefined;

  return {
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(outputPreview ? { outputPreview } : {}),
    durationMs: result.durationMs,
    bytesProduced: result.bytesProduced,
    truncated: result.truncated,
    redacted: result.redacted,
  };
}

export function truncateForLogField(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Extract public hosts from a successful web_search tool output (cap 16). */
export function extractHostsFromWebSearchOutput(output: unknown): string[] {
  if (!output || typeof output !== "object") {
    return [];
  }
  const record = output as { results?: unknown; query?: unknown };
  const results = record.results;
  const hosts = new Set<string>();
  if (Array.isArray(results)) {
    for (const hit of results) {
      if (!hit || typeof hit !== "object") continue;
      const url = (hit as { url?: unknown }).url;
      if (typeof url !== "string" || url.trim().length === 0) continue;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
        const host = parsed.hostname.toLowerCase();
        if (
          !host ||
          host === "localhost" ||
          host.endsWith(".local") ||
          host === "127.0.0.1" ||
          host === "::1"
        ) {
          continue;
        }
        hosts.add(host);
      } catch {
        continue;
      }
      if (hosts.size >= 12) break;
    }
  }

  const query = typeof record.query === "string" ? record.query : "";
  for (const host of inferPackageRegistryHostsFromQuery(query)) {
    hosts.add(host);
  }
  for (const host of expandRelatedNetworkHosts([...hosts])) {
    hosts.add(host);
  }
  return [...hosts].slice(0, 16);
}

/** Admit canonical package registries when search results already touch that ecosystem. */
export function expandRelatedNetworkHosts(hosts: readonly string[]): string[] {
  const set = new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  const extra: string[] = [];
  const touches = (...needles: string[]) =>
    [...set].some(
      (host) =>
        needles.some((needle) => host === needle || host.endsWith(`.${needle}`)),
    );

  if (touches("npmjs.com", "npmjs.org")) {
    extra.push("registry.npmjs.org", "www.npmjs.com", "npmjs.com");
  }
  if (touches("pypi.org", "pythonhosted.org")) {
    extra.push("pypi.org", "files.pythonhosted.org");
  }
  if (touches("crates.io", "docs.rs")) {
    extra.push("crates.io", "static.crates.io", "docs.rs");
  }
  if (touches("proxy.golang.org", "pkg.go.dev", "sum.golang.org")) {
    extra.push("proxy.golang.org", "pkg.go.dev", "sum.golang.org");
  }
  return extra.filter((host) => !set.has(host));
}

/**
 * When the search query looks like an npm/PyPI/crates package lookup, admit
 * the matching registry so follow-up fetch_url can hit the API, not only HTML
 * result pages (e.g. Snyk / GitHub) from the first hit list.
 */
export function inferPackageRegistryHostsFromQuery(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const hosts: string[] = [];
  if (
    /\bnpm\b/i.test(q) ||
    /(?:^|[\s"`'])@[a-z0-9][\w.-]*\/[\w.-]+/i.test(q) ||
    /\b(?:package\.json|node_modules|npmjs)\b/i.test(q)
  ) {
    hosts.push("registry.npmjs.org", "www.npmjs.com", "npmjs.com");
  }
  if (/\b(?:pypi|pip install|pyproject\.toml|requirements\.txt)\b/i.test(q)) {
    hosts.push("pypi.org", "files.pythonhosted.org");
  }
  if (/\b(?:crates\.io|cargo add|Cargo\.toml)\b/i.test(q)) {
    hosts.push("crates.io", "static.crates.io", "docs.rs");
  }
  if (/\b(?:pkg\.go\.dev|go get|go\.mod)\b/i.test(q)) {
    hosts.push("proxy.golang.org", "pkg.go.dev", "sum.golang.org");
  }
  return hosts;
}

export type GrantRefreshOutcome =
  | { kind: "ok" }
  | { kind: "expansion_required"; extraPaths: string[] };

export async function refreshAuthorityAfterTools(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  bus: EventBus;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  messages: ModelMessage[];
  decisionRef: {
    get: () => ExecutionDecision;
    set: (decision: ExecutionDecision) => void;
  };
  selectedSkillIdsRef: {
    get: () => string[];
    set: (ids: string[]) => void;
  };
  changedFiles: readonly string[];
  dirtyPaths: readonly string[] | undefined;
  extraPaths?: readonly string[];
  /** Hosts from successful web_search results for follow-up fetch_url. */
  extraNetworkHosts?: readonly string[];
  understanding?: RequestUnderstandingResult;
  skillsQuery?: string;
  mode?: "ask" | "plan" | "agent";
  projects?: readonly ProjectDescriptor[];
  route: ExecutionDecision["route"];
  windowPolicy: WindowPolicy;
  requiredSkillIds?: readonly string[];
  excludedSkillIds?: readonly string[];
}): Promise<GrantRefreshOutcome> {
  const discoveredPaths = [
    ...new Set([
      ...(params.dirtyPaths ?? []),
      ...params.changedFiles,
    ]),
  ]
    .filter((path) => path.trim().length > 0)
    .slice(0, 50);

  const extraPaths = [...new Set(params.extraPaths ?? [])].filter(
    (path) => path.trim().length > 0,
  );
  const extraNetworkHosts = [
    ...new Set(
      (params.extraNetworkHosts ?? [])
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0),
    ),
  ].slice(0, 16);
  // Widen first so path_out_of_scope / compiler paths are admitted before any
  // discovery-based narrow can drop them. Also admit web_search result hosts.
  if (
    runtime.deps.decision.widen &&
    (extraPaths.length > 0 || extraNetworkHosts.length > 0)
  ) {
    const previous = params.decisionRef.get();
    const canAutoExpandPaths =
      previous.toolGrant.approvalMode === "never" ||
      previous.toolGrant.maximumWorkspaceEffect === "write" ||
      previous.toolGrant.maximumWorkspaceEffect === "read";
    const canAutoExpandHosts =
      previous.toolGrant.allowedEffects.includes("network_access") ||
      previous.toolGrant.allowedTools.includes("web_search") ||
      previous.toolGrant.allowedTools.includes("fetch_url");

    // Path expansion still requires an approval gate when effect is none.
    if (extraPaths.length > 0 && !canAutoExpandPaths) {
      return { kind: "expansion_required", extraPaths };
    }

    const widenPaths = canAutoExpandPaths ? extraPaths : [];
    const widenHosts = canAutoExpandHosts ? extraNetworkHosts : [];
    if (widenPaths.length > 0 || widenHosts.length > 0) {
      const widened = runtime.deps.decision.widen({
        previous,
        extraPaths: widenPaths,
        extraNetworkHosts: widenHosts,
      });
      if (!toolGrantsEquivalent(previous.toolGrant, widened.toolGrant)) {
        params.decisionRef.set(widened);
        params.reasonCodes.push("grant_expanded");
        runtime.emit(params.bus, {
          type: "grant_narrowed",
          runId: params.runId,
          maximumWorkspaceEffect: widened.toolGrant.maximumWorkspaceEffect,
          approvalMode: widened.toolGrant.approvalMode,
          pathScopes: widened.toolGrant.pathScopes.slice(0, 20),
          reasonCodes: widened.reasonCodes.slice(-8),
          truncated:
            widened.toolGrant.pathScopes.length > 20 ||
            widened.reasonCodes.length > 8
              ? true
              : undefined,
          at: runtime.isoNow(),
        });
      }
    }
  }

  if (runtime.deps.decision.narrow && discoveredPaths.length > 0) {
    const previous = params.decisionRef.get();
    const narrowed = runtime.deps.decision.narrow({
      previous,
      discoveredPaths,
      residualRisk: params.understanding?.taskAnalysis.risk,
    });
    if (!toolGrantsEquivalent(previous.toolGrant, narrowed.toolGrant)) {
      params.decisionRef.set(narrowed);
      params.reasonCodes.push("grant_narrowed");
      runtime.emit(params.bus, {
        type: "grant_narrowed",
        runId: params.runId,
        maximumWorkspaceEffect: narrowed.toolGrant.maximumWorkspaceEffect,
        approvalMode: narrowed.toolGrant.approvalMode,
        pathScopes: narrowed.toolGrant.pathScopes.slice(0, 20),
        reasonCodes: narrowed.reasonCodes.slice(-8),
        truncated:
          narrowed.toolGrant.pathScopes.length > 20 ||
          narrowed.reasonCodes.length > 8
            ? true
            : undefined,
        at: runtime.isoNow(),
      });
    }
  }

  if (
    !runtime.deps.skills ||
    !params.understanding ||
    !params.skillsQuery ||
    !params.mode ||
    discoveredPaths.length === 0
  ) {
    return { kind: "ok" };
  }

  const evidence = mapUnderstandingToSkillEvidence(params.understanding, {
    projects: params.projects,
    extraPaths: discoveredPaths,
  });
  const skillsResult = await runtime.deps.skills.select({
    schemaVersion: SKILLS_SCHEMA_VERSION,
    query: params.skillsQuery,
    mode: params.mode,
    route: params.route,
    budgetTokens: params.windowPolicy.skills.budgetTokens,
    maxSkills: params.windowPolicy.skills.maxSkills,
    requiredSkillIds: [...(params.requiredSkillIds ?? [])],
    excludedSkillIds: [...(params.excludedSkillIds ?? [])],
    forbidLargeSkills:
      resolveWindowBudgetBand(params.windowPolicy.contextWindowTokens) ===
      "compact",
    evidence,
  });
  const nextIds = skillsResult.instructions.map((block) => block.id);
  const previousIds = params.selectedSkillIdsRef.get();
  const changed =
    nextIds.length !== previousIds.length ||
    nextIds.some((id, index) => id !== previousIds[index]);
  if (!changed || skillsResult.instructions.length === 0) {
    return { kind: "ok" };
  }

  params.selectedSkillIdsRef.set(nextIds);
  params.reasonCodes.push("skills_refreshed");
  const refreshContent = skillsResult.instructions
    .map((block) => {
      const body = formatSkillPromptContent(block);
      return `### ${block.title ?? block.id}\n${body}`;
    })
    .join("\n\n");
  params.messages.push({
    role: "user",
    content: `Updated skill guidance after discovery (follow within current tool grant):\n\n${refreshContent}`,
  });
  runtime.emit(
    params.bus,
    buildSkillsReadyEvent({
      runId: params.runId,
      skillsResult,
      at: runtime.isoNow(),
    }),
  );
  return { kind: "ok" };
}
