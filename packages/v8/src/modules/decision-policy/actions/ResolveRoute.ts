import type { RequestUnderstandingResult } from "../../request-understanding";

import {
  DIAGNOSIS_TASK_INTENTS,
  MUTATION_TASK_INTENTS,
} from "../constants";
import type { DecisionReasonCode, ExecutionRoute } from "../contracts";
import { DECISION_POLICY_THRESHOLDS } from "../policy";
import { looksLikeWorkspaceBugReport } from "./LooksLikeWorkspaceBugReport";

export interface RouteResolution {
  route: ExecutionRoute;
  runDisposition: "continue" | "clarification_required";
  reasonCodes: DecisionReasonCode[];
}

const MUTATION_INTENT_SET = new Set<string>(MUTATION_TASK_INTENTS);
const DIAGNOSIS_INTENT_SET = new Set<string>(DIAGNOSIS_TASK_INTENTS);

export function isMutationIntent(intent: string): boolean {
  return MUTATION_INTENT_SET.has(intent);
}

export function isDiagnosisIntent(intent: string): boolean {
  return DIAGNOSIS_INTENT_SET.has(intent);
}

export function resolveRoute(params: {
  mode: "ask" | "plan" | "agent";
  understanding: RequestUnderstandingResult;
  message: string;
}): RouteResolution {
  const { mode, understanding, message } = params;
  const { intent, taskAnalysis } = understanding;
  const primary = intent.classification.primaryTaskIntent;
  const interaction = intent.classification.interactionIntent;
  const reasonCodes: DecisionReasonCode[] = [];

  if (requiresClarification(understanding, message, mode)) {
    reasonCodes.push("clarification_material");
    return {
      route: "clarify",
      runDisposition: "clarification_required",
      reasonCodes,
    };
  }

  if (mode === "ask") {
    reasonCodes.push("mode_ask_readonly");
    return resolveAskRoute({
      primary,
      taskAnalysis,
      message,
      reasonCodes,
    });
  }

  if (mode === "plan") {
    reasonCodes.push("mode_plan_only");
    if (isExplicitPlanRequest(message) || interaction === "plan") {
      reasonCodes.push("explicit_plan_request");
    }
    return {
      route: "plan",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  // agent mode
  if (interaction === "plan" || isExplicitPlanRequest(message)) {
    reasonCodes.push("explicit_plan_request");
    return {
      route: "plan",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (isDiagnosisIntent(primary)) {
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  // Mutation must win over question-shaped phrasing ("Can you implement…?").
  // Previously interactionIntent=question short-circuited to repository_answer
  // and stripped apply_patch even in agent mode.
  if (
    !isExplicitReadOnlyRequest(message) &&
    (isMutationIntent(primary) ||
      interaction === "act" ||
      looksLikeAgentMutationRequest(message))
  ) {
    reasonCodes.push("mutation_execute");
    return {
      route: "execute",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (looksLikeWorkspaceBugReport(message)) {
    reasonCodes.push("workspace_bug_execute");
    return {
      route: "execute",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (
    primary === "question" ||
    interaction === "question" ||
    interaction === "help" ||
    (primary === "docs" && !looksLikeDocsMutation(message))
  ) {
    if (needsRepositoryGrounding(taskAnalysis, message)) {
      reasonCodes.push("repository_grounded_answer");
      return {
        route: "repository_answer",
        runDisposition: "continue",
        reasonCodes,
      };
    }
    reasonCodes.push("direct_knowledge_answer");
    return {
      route: "direct_answer",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (needsRepositoryGrounding(taskAnalysis, message)) {
    reasonCodes.push("repository_grounded_answer");
    return {
      route: "repository_answer",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  reasonCodes.push("direct_knowledge_answer");
  return {
    route: "direct_answer",
    runDisposition: "continue",
    reasonCodes,
  };
}

function resolveAskRoute(params: {
  primary: string;
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"];
  message: string;
  reasonCodes: DecisionReasonCode[];
}): RouteResolution {
  const { primary, taskAnalysis, message, reasonCodes } = params;

  if (isDiagnosisIntent(primary)) {
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (
    needsRepositoryGrounding(taskAnalysis, message) ||
    primary === "docs" ||
    isMutationIntent(primary)
  ) {
    reasonCodes.push("repository_grounded_answer");
    return {
      route: "repository_answer",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  reasonCodes.push("direct_knowledge_answer");
  return {
    route: "direct_answer",
    runDisposition: "continue",
    reasonCodes,
  };
}

function needsRepositoryGrounding(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
  message: string,
): boolean {
  if (taskAnalysis.recommendsRepositoryDiscovery) {
    return true;
  }
  if (hasExplicitRepoTargets(taskAnalysis)) {
    return true;
  }
  if (
    taskAnalysis.scope === "repository" ||
    taskAnalysis.scope === "workspace" ||
    taskAnalysis.scope === "package" ||
    taskAnalysis.scope === "multi_file"
  ) {
    return true;
  }
  return looksLikeWorkspaceGroundedRequest(message);
}

function requiresClarification(
  understanding: RequestUnderstandingResult,
  message: string,
  mode: "ask" | "plan" | "agent",
): boolean {
  // Resume already amended the user ask with a clarification answer — do not
  // suspend again for the same ambiguity.
  if (hasResolvedClarification(message)) {
    return false;
  }

  // Agent mode: clear actionable mutation asks should execute even when
  // understanding marks soft ambiguity (avoids stalling "implement X" work).
  if (
    mode === "agent" &&
    looksLikeAgentMutationRequest(message) &&
    !isBareAmbiguousMutationAsk(message)
  ) {
    return false;
  }

  const { intent, taskAnalysis } = understanding;

  if (intent.status === "clarification_required") {
    return true;
  }
  if (intent.recommendsClarification) {
    return true;
  }
  if (intent.classification.needsClarification) {
    return true;
  }

  if (
    taskAnalysis.recommendsTaskClarification &&
    taskAnalysis.clarity === "unclear"
  ) {
    return true;
  }

  if (
    taskAnalysis.clarity === "unclear" &&
    intent.classification.confidence <
      DECISION_POLICY_THRESHOLDS.lowIntentConfidence
  ) {
    return true;
  }

  if (
    taskAnalysis.clarity === "unclear" &&
    intent.confidenceMargin < DECISION_POLICY_THRESHOLDS.minimumIntentMargin &&
    intent.classification.alternatives.length > 0
  ) {
    return true;
  }

  return false;
}

/** Pronoun-only / tiny mutation asks that still need a target. */
function isBareAmbiguousMutationAsk(message: string): boolean {
  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length < 48) {
    return true;
  }
  return /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:fix|update|change|do|implement|handle)\s+(?:it|this|that)\b[.!?]*$/i.test(
    text,
  );
}

function hasResolvedClarification(message: string): boolean {
  return /\nClarification:\s*\S+/i.test(message);
}

function hasExplicitRepoTargets(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
): boolean {
  return taskAnalysis.targets.some(
    (target) =>
      target.explicit &&
      (target.kind === "file" ||
        target.kind === "folder" ||
        target.kind === "symbol" ||
        target.kind === "package" ||
        target.kind === "repository" ||
        target.kind === "workspace"),
  );
}

function isExplicitPlanRequest(message: string): boolean {
  return /\b(make\s+a\s+plan|create\s+a\s+plan|plan\s+only|write\s+a\s+plan|propose\s+a\s+plan)\b/i.test(
    message,
  );
}

function looksLikeDocsMutation(message: string): boolean {
  return /\b(write|add|update|create|draft|document)\b/i.test(message);
}

/**
 * Explicit read-only / no-edit constraints — never promote to execute.
 */
function isExplicitReadOnlyRequest(message: string): boolean {
  return (
    /\b(?:do not|don't|dont|without)\s+(?:edit|change|modify|fix|implement|apply|write|update|remove|refactor|touch)\b/i.test(
      message,
    ) ||
    /\b(?:explain|review|diagnose|analyze|investigate)\s+only\b/i.test(
      message,
    ) ||
    /\bno\s+(?:code|file)\s+changes\b/i.test(message) ||
    /\bread[- ]only\b/i.test(message) ||
    /\b(?:do not|don't|dont)\s+implement\b/i.test(message) ||
    /\bwithout\s+implementing\b/i.test(message)
  );
}

/**
 * Agent-mode safety net when understanding classifies an implementation ask
 * as a "question" (common with "Can you implement…?").
 */
function looksLikeAgentMutationRequest(message: string): boolean {
  if (isExplicitReadOnlyRequest(message) || isExplicitPlanRequest(message)) {
    return false;
  }

  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length === 0) {
    return false;
  }

  // How-to / what-is / past-tense status phrasing expects an answer, not a write grant.
  if (
    /^(?:how\s+(?:do|does|did|can|should|would|to)|why\s+|what\s+(?:is|are|does|would|did|was|were)|when\s+|where\s+|which\s+)/i.test(
      text,
    ) ||
    /^(?:can you\s+)?(?:how|why|what|when|where|which)\b/i.test(text) ||
    /^(?:please\s+)?(?:explain|compare|describe|clarify|tell me|find|list|show|summarize|analyse|analyze)\b/i.test(
      text,
    ) ||
    // Follow-ups about prior work ("did you clear…?", "have you finished…?")
    /^(?:so\s+|and\s+|ok[,.]?\s+|okay[,.]?\s+)?(?:did|have|has|were|was|are|is)\s+(?:you|we|it|they|the)\b/i.test(
      text,
    )
  ) {
    return false;
  }

  return (
    /(?:^|\b)(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|i\s+want\s+you\s+to\s+|i\s+need\s+you\s+to\s+|i\s+need\s+|we\s+need\s+to\s+|let(?:'s|\s+us)\s+)?(?:implement|build|create|design|develop|write|add|fix|resolve|repair|patch|migrate|refactor|rewrite|convert|integrate|configure|optimize|redesign|replace|remove|delete|update|modify|generate|scaffold|install|upgrade)\b/i.test(
      text,
    ) ||
    /\bi\s+need\s+(?:to\s+design\s+|to\s+create\s+|to\s+build\s+|an?\s+|the\s+)*(?:api|endpoint|route)\b/i.test(
      text,
    )
  );
}

/**
 * Ask/agent questions about the open workspace that understanding may still
 * classify as generic "question" with unknown scope.
 */
function looksLikeWorkspaceGroundedRequest(message: string): boolean {
  const text = message.trim();
  if (text.length === 0) {
    return false;
  }

  if (
    /\b(?:this|the|current)\s+(?:project|repo|repository|codebase|workspace|code)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (
    /\b(?:in|across|throughout|within|of|on)\s+(?:this|the|current)\s+(?:project|repo|repository|codebase|workspace)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (
    /\b(?:test cases?|specs?|page objects?|how to run|architecture|redundant code|working tree|file map|source files?)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (
    /\b(?:i\s+need|we\s+need|design|create|build|implement)\b[\s\S]{0,100}\b(?:api|endpoint|route|controller|service|database|db|query|analytics?)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (
    /\b(?:list|find|count|locate|search|read|open|show|inspect|analyze|analyse)\b[\s\S]{0,60}\b(?:files?|tests?|specs?|directories|folders?|modules?|packages?)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (looksLikeWorkspaceBugReport(text)) {
    return true;
  }

  return false;
}
