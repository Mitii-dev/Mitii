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
  understanding?: RequestUnderstandingResult;
  skillsQuery?: string;
  mode?: "ask" | "plan" | "agent";
  projects?: readonly ProjectDescriptor[];
  route: ExecutionDecision["route"];
  windowPolicy: WindowPolicy;
  requiredSkillIds?: readonly string[];
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
  // Widen first so path_out_of_scope / compiler paths are admitted before any
  // discovery-based narrow can drop them.
  if (runtime.deps.decision.widen && extraPaths.length > 0) {
    const previous = params.decisionRef.get();
    const widened = runtime.deps.decision.widen({
      previous,
      extraPaths,
    });
    if (!toolGrantsEquivalent(previous.toolGrant, widened.toolGrant)) {
      // Path/mutation scope expansion does not add write authority — only
      // admits paths needed by an already-granted write/read effect. Auto-apply
      // whenever write (or read) is already allowed so required companion files
      // are not blocked behind a second approval gate.
      const canAutoExpand =
        previous.toolGrant.approvalMode === "never" ||
        previous.toolGrant.maximumWorkspaceEffect === "write" ||
        previous.toolGrant.maximumWorkspaceEffect === "read";
      if (!canAutoExpand) {
        return { kind: "expansion_required", extraPaths };
      }
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
