import type { RequestUnderstandingResult } from "../../request-understanding";

import {
  DIAGNOSIS_TASK_INTENTS,
  MUTATION_TASK_INTENTS,
} from "../constants";
import type { DecisionReasonCode, ExecutionRoute } from "../contracts";
import { DECISION_POLICY_THRESHOLDS } from "../policy";

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

  if (requiresClarification(understanding)) {
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

  if (isDiagnosisIntent(primary) || interaction === "help") {
    if (isDiagnosisIntent(primary)) {
      reasonCodes.push("diagnosis_readonly");
      return {
        route: "diagnose",
        runDisposition: "continue",
        reasonCodes,
      };
    }
  }

  if (
    primary === "question" ||
    interaction === "question" ||
    (primary === "docs" && !looksLikeDocsMutation(message))
  ) {
    if (
      taskAnalysis.recommendsRepositoryDiscovery ||
      hasExplicitRepoTargets(taskAnalysis)
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

  if (isMutationIntent(primary) || interaction === "act") {
    reasonCodes.push("mutation_execute");
    return {
      route: "execute",
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

  if (taskAnalysis.recommendsRepositoryDiscovery) {
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
  reasonCodes: DecisionReasonCode[];
}): RouteResolution {
  const { primary, taskAnalysis, reasonCodes } = params;

  if (isDiagnosisIntent(primary)) {
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (
    taskAnalysis.recommendsRepositoryDiscovery ||
    hasExplicitRepoTargets(taskAnalysis) ||
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

function requiresClarification(
  understanding: RequestUnderstandingResult,
): boolean {
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

function hasExplicitRepoTargets(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
): boolean {
  return taskAnalysis.targets.some(
    (target) =>
      target.explicit &&
      (target.kind === "file" ||
        target.kind === "folder" ||
        target.kind === "symbol" ||
        target.kind === "package"),
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
