/**
 * Refresh decision grant / skills after tool discovery.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import { toolGrantsEquivalent } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { ProjectDescriptor } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import { resolveWindowBudgetBand } from "../../../modules/window-budget";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import {
  SKILLS_SCHEMA_VERSION,
  formatSkillPromptContent,
  mapUnderstandingToSkillEvidence,
} from "../../../modules/skills";

import { buildSkillsReadyEvent } from "../actions";
import type { AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { AgentEngineRuntime } from "./runtime";

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
  // Path scope expansion always asks the user (even full-access / write grants).
  // Network host expansion may still auto-admit when network tools are already granted.
  if (
    runtime.deps.decision.widen &&
    (extraPaths.length > 0 || extraNetworkHosts.length > 0)
  ) {
    const previous = params.decisionRef.get();
    if (extraPaths.length > 0) {
      return { kind: "expansion_required", extraPaths };
    }

    const canAutoExpandHosts =
      previous.toolGrant.allowedEffects.includes("network_access") ||
      previous.toolGrant.allowedTools.includes("web_search") ||
      previous.toolGrant.allowedTools.includes("fetch_url");

    const widenHosts = canAutoExpandHosts ? extraNetworkHosts : [];
    if (widenHosts.length > 0) {
      const widened = runtime.deps.decision.widen({
        previous,
        upgradePlateId: "upgrade_unlock_network",
        extraPaths: [],
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
