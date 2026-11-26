/**
 * Map runtime decision + briefcase materials → PromptConstructionInput.
 */

import {
  DECISION_POLICY_SCHEMA_VERSION,
  type ExecutionDecision,
  type ToolGrant,
  type VerificationRequirement,
} from "../../../modules/decision-policy";
import { PROMPT_CONSTRUCTION_SCHEMA_VERSION } from "../../../modules/prompt-construction";
import type { PromptConstructionInput } from "../../../modules/prompt-construction";
import type { ContextBundle } from "../../contracts/enrich/ContextBundle";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";
import type { TaskList } from "../../../modules/task-list";
import { formatTaskListForBriefcase } from "../task/FormatTaskListForBriefcase";

const EVIDENCE = new Set([
  "diagnostics",
  "tests",
  "typecheck",
  "lint",
  "build",
  "diff_review",
  "behavior",
] as const);

type EvidenceKind = VerificationRequirement["minimumEvidence"][number];

function mapRoute(route: string): ExecutionDecision["route"] {
  if (route === "direct_answer" || route === "repository_answer") {
    return "answer";
  }
  if (
    route === "answer" ||
    route === "clarify" ||
    route === "diagnose" ||
    route === "plan" ||
    route === "execute"
  ) {
    return route;
  }
  return "execute";
}

function mapEvidence(raw: readonly string[] | undefined): EvidenceKind[] {
  const out: EvidenceKind[] = [];
  for (const item of raw ?? []) {
    if (EVIDENCE.has(item as EvidenceKind)) {
      out.push(item as EvidenceKind);
    }
  }
  return out.length > 0 ? out : ["diagnostics"];
}

function defaultReadGrant(): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: ["read_file"],
    allowedEffects: ["workspace_read"],
    pathScopes: ["."],
    approvalMode: "when_required",
    limits: {
      maxToolCalls: 32,
      maxWallTimeMs: 120_000,
      maxOutputBytes: 1_048_576,
    },
  };
}

export function mapSketchToPromptConstructionInput(input: {
  message: string;
  decision: RuntimeDecisionSketch;
  contextBundle?: ContextBundle;
  taskList?: TaskList;
  contextWindowTokens?: number;
  conversation?: Array<{ role: string; content: string }>;
}): PromptConstructionInput {
  const route = mapRoute(input.decision.route);
  const evidence = mapEvidence(
    input.decision.verification?.checks ??
      input.decision.verification?.minimumEvidence,
  );
  const grant = input.decision.toolGrant ?? defaultReadGrant();

  const decision: ExecutionDecision = {
    schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
    route,
    planningDepth:
      input.decision.planningDepth === "visible" ||
      input.decision.planningDepth === "internal" ||
      input.decision.planningDepth === "none"
        ? input.decision.planningDepth
        : "none",
    planGate:
      input.decision.planGate === "required_before_execute"
        ? "required_before_execute"
        : "none",
    runDisposition: input.decision.runDisposition,
    repositoryContextRequired: input.decision.repositoryContextRequired,
    toolGrant: grant,
    verification: {
      required: input.decision.verification.required,
      minimumEvidence: evidence,
      checks: evidence,
      allowUnavailable: input.decision.verification.allowUnavailable,
      onFailure: input.decision.verification.onFailure ?? "report",
    },
    reasonCodes: ["simple_localized_no_visible_plan"],
    rationale: input.decision.rationale || "runtime briefcase pack",
    warnings: [],
  };

  const taskFmt = formatTaskListForBriefcase(input.taskList);
  const instructions = {
    ...(input.contextBundle?.projectRules?.text
      ? {
          projectRules: [
            {
              id: "project_rules",
              content: input.contextBundle.projectRules.text,
              priority: 10,
            },
          ],
        }
      : {}),
    skills: (input.contextBundle?.skills?.items ?? []).map((content, i) => ({
      id: `skill_${i}`,
      content,
      priority: 50,
    })),
    memory: (input.contextBundle?.memory?.items ?? []).map((content, i) => ({
      id: `memory_${i}`,
      content,
      priority: 80,
    })),
  };

  const planText = taskFmt.promptBlock;
  const tokens = Math.max(4_096, input.contextWindowTokens ?? 80_000);
  const maxOut = Math.min(8_192, Math.max(256, Math.floor(tokens * 0.1)));

  return {
    schemaVersion: PROMPT_CONSTRUCTION_SCHEMA_VERSION,
    decision,
    userMessage: input.message,
    conversation: (input.conversation ?? []).map((m) => ({
      role: (m.role === "assistant" || m.role === "system" || m.role === "tool"
        ? m.role
        : "user") as "user" | "assistant" | "system" | "tool",
      content: m.content,
    })),
    instructions,
    ...(input.contextBundle?.decisionBrief
      ? { decisionBriefText: input.contextBundle.decisionBrief }
      : {}),
    ...(planText ? { planText } : {}),
    capabilities: {
      modelId: "runtime-default",
      contextWindowTokens: tokens,
      maximumOutputTokens: maxOut,
      supportsTools: true,
      supportsStreaming: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutput: false,
      supportsVision: false,
      supportsReasoning: false,
      supportsPromptCaching: false,
      supportsEmbeddings: false,
    },
    tools: (grant.allowedTools ?? []).map((name) => ({
      name,
      description: name,
      inputSchema: { type: "object", properties: {} },
    })),
  };
}
