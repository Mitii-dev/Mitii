import type {
  RequestTurnKind,
} from "../../request-intake";
import {
  isContinuationTurnKind,
} from "../../request-understanding";
import type {
  RequestUnderstandingResult,
} from "../../request-understanding";
import type {
  DecisionReasonCode,
  ExecutionRoute,
} from "../contracts";
import type { EndingPosture } from "../../request-understanding";
import {
  looksLikeWorkspaceBugReport,
} from "./LooksLikeWorkspaceBugReport";
import { applyContinuityBias } from "./ApplyContinuityBias";
import {
  isDiagnosisIntent,
  isMutationIntent,
} from "./RouteIntents";
import {
  isExplicitPlanRequest,
  isExplicitReadOnlyRequest,
  isHardPlanOnlyRequest,
  isSoftExplicitPlanRequest,
  looksLikeAgentExecuteContinue,
  looksLikeAgentMutationRequest,
  looksLikeAgentVerificationRequest,
  looksLikeCodeReviewRequest,
  looksLikeDocsMutation,
  looksLikePastedRuntimeErrorDump,
  looksLikeWorkspaceRuntimeSymptom,
} from "./RouteMessageSignals";
import {
  isHighConfidenceUnderstanding,
  officerAuthorizesWriteDespiteDump,
  shouldGrantMutationExecute,
  understandingTrustsWriteBallot,
  writeBlockedByReadOnlyConstraint,
} from "./RouteBallotAuthority";
import { isExplicitCreateAsk } from "./RouteCreateAsk";
import {
  needsRepositoryGrounding,
  requiresClarification,
} from "./RouteClarification";

export interface RouteResolution {
  route: ExecutionRoute;
  runDisposition: "continue" | "clarification_required";
  reasonCodes: DecisionReasonCode[];
}


export function resolveRoute(params: {
  mode: "ask" | "plan" | "agent";
  understanding: RequestUnderstandingResult;
  message: string;
  /**
   * When true, skip the clarify early-return so unattended hosts
   * (automation / api) can continue with a best-effort route.
   */
  suppressClarification?: boolean;
  /**
   * Prefer high-confidence understanding over looksLike* except safety
   * overrides. Default on when omitted; set false to force classic path.
   */
  policyFactsFirst?: boolean;
  /** Intake turn kind — continuation turns prefer ballot over soft clarify. */
  turnKind?: RequestTurnKind;
  priorRoute?: string;
  endingPosture?: EndingPosture;
}): RouteResolution {
  const { mode, understanding, message } = params;
  const { intent, taskAnalysis } = understanding;
  const primary = intent.classification.primaryTaskIntent;
  const interaction = intent.classification.interactionIntent;
  const reasonCodes: DecisionReasonCode[] = [];
  const continuation = isContinuationTurnKind(params.turnKind);
  // High-confidence understanding is authoritative unless the host kill-switches
  // facts-first (`policyFactsFirst: false`). Aligns with SuperIntent ≥0.70.
  const factsFirst =
    params.policyFactsFirst !== false &&
    isHighConfidenceUnderstanding(understanding);

  if (
    !params.suppressClarification &&
    requiresClarification(understanding, message, mode, continuation)
  ) {
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
  // Hard "plan only" always wins. Soft "make a plan" yields to ≥70% act/mutation.
  // Ballot interaction "plan" still routes to plan (LLM asked for plan-only),
  // except continuation turns where Request Understanding already promoted
  // plan-approval phrases ("go ahead") to act — trust that ballot.
  if (isHardPlanOnlyRequest(message)) {
    reasonCodes.push("explicit_plan_request");
    return {
      route: "plan",
      runDisposition: "continue",
      reasonCodes,
    };
  }
  // Explicit imperative "create X" must execute even if the ballot says plan.
  if (interaction === "plan" && isExplicitCreateAsk(message)) {
    reasonCodes.push("agent_create_ask_execute");
    reasonCodes.push("mutation_execute");
    return {
      route: "execute",
      runDisposition: "continue",
      reasonCodes,
    };
  }
  const continuity = applyContinuityBias({
    mode,
    turnKind: params.turnKind,
    priorRoute: params.priorRoute,
    endingPosture: params.endingPosture,
    interactionIntent: interaction as
      | "question"
      | "plan"
      | "act"
      | "help"
      | "unknown",
    primaryTaskIntent: primary,
    secondaryTaskIntents: intent.classification.secondaryTaskIntents,
  });
  if (continuity.preferredRoute === "execute") {
    reasonCodes.push("continuity_bias_execute");
    reasonCodes.push("mutation_execute");
    return {
      route: "execute",
      runDisposition: "continue",
      reasonCodes,
    };
  }
  if (continuity.preferredRoute === "answer") {
    reasonCodes.push("continuity_bias_answer");
    reasonCodes.push("repository_grounded_answer");
    return {
      route: "answer",
      runDisposition: "continue",
      reasonCodes,
    };
  }
  // Weak fallback when continuity was not stamped.
  if (
    !params.endingPosture &&
    continuation &&
    looksLikeAgentExecuteContinue(message)
  ) {
    reasonCodes.push("mutation_execute");
    return {
      route: "execute",
      runDisposition: "continue",
      reasonCodes,
    };
  }
  if (interaction === "plan") {
    if (!(continuation && understandingTrustsWriteBallot(understanding))) {
      reasonCodes.push("explicit_plan_request");
      return {
        route: "plan",
        runDisposition: "continue",
        reasonCodes,
      };
    }
    reasonCodes.push("policy_llm_authority_write");
  }
  if (isSoftExplicitPlanRequest(message)) {
    if (!understandingTrustsWriteBallot(understanding)) {
      reasonCodes.push("explicit_plan_request");
      return {
        route: "plan",
        runDisposition: "continue",
        reasonCodes,
      };
    }
    reasonCodes.push("policy_llm_authority_write");
  }

  // Pasted dumps stay diagnose-first by default. Officer write intent
  // (trusted ≥70% ballot, or soft act+mutation on test-failure pastes) wins.
  if (looksLikePastedRuntimeErrorDump(message)) {
    if (!officerAuthorizesWriteDespiteDump(understanding, message)) {
      reasonCodes.push("policy_facts_safety_override");
      reasonCodes.push("diagnosis_readonly");
      return {
        route: "diagnose",
        runDisposition: "continue",
        reasonCodes,
      };
    }
    reasonCodes.push("policy_llm_authority_write");
  }

  if (factsFirst) {
    reasonCodes.push("policy_facts_first");
    return resolveAgentRouteFactsFirst({
      understanding,
      message,
      reasonCodes,
      suppressClarification: params.suppressClarification === true,
      continuation,
    });
  }

  // Mutation must win over soft diagnosis labels and question-shaped phrasing
  // ("Edit docs/…", "Can you fix that?", "implement…?"). Previously
  // isDiagnosisIntent ran first and stripped apply_patch for edit/fix asks
  // that understanding classified as investigate_symptom / diagnose.
  //
  // Soft "don't remove…" keyword hits must not veto a ≥70% LLM act ballot
  // (follow-ups included). Hard read-only ("no code changes") still wins.
  if (shouldGrantMutationExecute({ understanding, message, reasonCodes })) {
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

  // "Run the tests / what is failing" must not fall through to direct_answer
  // (zero tools). Diagnose grants run_readonly_command. Skip when a ≥70%
  // write ballot already lost the mutation gate for other reasons.
  if (
    looksLikeAgentVerificationRequest(message) &&
    !understandingTrustsWriteBallot(understanding)
  ) {
    reasonCodes.push("verification_run_requested");
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
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

  // Agent mode must not collapse workspace symptoms into tool-less chat.
  // Prefer read-only diagnosis over direct_answer when the user reports
  // loading/hang/server issues without an explicit "fix it".
  if (
    looksLikeWorkspaceRuntimeSymptom(message) &&
    !understandingTrustsWriteBallot(understanding)
  ) {
    reasonCodes.push("workspace_symptom_diagnose");
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
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
        route: "answer",
        runDisposition: "continue",
        reasonCodes,
      };
    }
    reasonCodes.push("direct_knowledge_answer");
    return {
      route: "answer",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (needsRepositoryGrounding(taskAnalysis, message)) {
    reasonCodes.push("repository_grounded_answer");
    return {
      route: "answer",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  reasonCodes.push("direct_knowledge_answer");
  return {
    route: "answer",
    runDisposition: "continue",
    reasonCodes,
  };
}


/**
 * Facts-first agent routing: understanding drives route; looksLike* are weak
 * priors. Material heuristic-vs-ballot conflict → clarify (or safe diagnose
 * when clarification is suppressed / continuation turn).
 */
function resolveAgentRouteFactsFirst(params: {
  understanding: RequestUnderstandingResult;
  message: string;
  reasonCodes: DecisionReasonCode[];
  suppressClarification: boolean;
  continuation?: boolean;
}): RouteResolution {
  const { understanding, message, reasonCodes, suppressClarification } = params;
  const { intent, taskAnalysis } = understanding;
  const primary = intent.classification.primaryTaskIntent;
  const interaction = intent.classification.interactionIntent;

  const understandingWantsWrite =
    !writeBlockedByReadOnlyConstraint(understanding, message, reasonCodes) &&
    (isMutationIntent(primary) || interaction === "act");
  const heuristicWantsWrite =
    !isExplicitReadOnlyRequest(message) &&
    (looksLikeAgentMutationRequest(message) ||
      looksLikeAgentExecuteContinue(message) ||
      looksLikeWorkspaceBugReport(message));
  const understandingWantsRead =
    interaction === "question" ||
    interaction === "help" ||
    primary === "question" ||
    (primary === "docs" && !looksLikeDocsMutation(message));

  // Material conflict: heuristic wants write, ballot wants read.
  // Clear mutation / workspace-bug phrasing beats a stale question ballot
  // (classic product rule). Soft "just explain" codas and diagnose/help
  // ballots keep read authority; remaining ambiguous conflicts clarify.
  if (heuristicWantsWrite && understandingWantsRead && !understandingWantsWrite) {
    const explainOnlyCoda =
      /\bjust\s+explain\b|\bexplain\s+(?:only|for\s+now)\b|\bwithout\s+(?:changing|editing|fixing|modifying)\b/i.test(
        message,
      );
    const clearMutationAsk =
      !explainOnlyCoda &&
      (looksLikeAgentMutationRequest(message) ||
        (looksLikeWorkspaceBugReport(message) &&
          !isDiagnosisIntent(primary) &&
          interaction !== "help"));
    if (clearMutationAsk) {
      reasonCodes.push("policy_facts_heuristic_conflict_clarify");
      if (looksLikeWorkspaceBugReport(message)) {
        reasonCodes.push("workspace_bug_execute");
      } else {
        reasonCodes.push("mutation_execute");
      }
      return {
        route: "execute",
        runDisposition: "continue",
        reasonCodes,
      };
    }
    // Diagnose/help ballot + soft failure language → diagnose, not clarify.
    if (isDiagnosisIntent(primary) || interaction === "help") {
      reasonCodes.push("policy_facts_heuristic_conflict_clarify");
      reasonCodes.push("diagnosis_readonly");
      return {
        route: "diagnose",
        runDisposition: "continue",
        reasonCodes,
      };
    }
    reasonCodes.push("policy_facts_heuristic_conflict_clarify");
    if (!suppressClarification && !params.continuation) {
      reasonCodes.push("clarification_material");
      return {
        route: "clarify",
        runDisposition: "clarification_required",
        reasonCodes,
      };
    }
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (understandingWantsWrite) {
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

  if (
    looksLikeAgentVerificationRequest(message) &&
    !understandingTrustsWriteBallot(understanding)
  ) {
    reasonCodes.push("verification_run_requested");
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  // Soft heuristic only when understanding did not assert a clear path.
  if (
    looksLikeWorkspaceRuntimeSymptom(message) &&
    !understandingWantsWrite &&
    !understandingTrustsWriteBallot(understanding)
  ) {
    reasonCodes.push("workspace_symptom_diagnose");
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (understandingWantsRead) {
    if (needsRepositoryGrounding(taskAnalysis, message)) {
      reasonCodes.push("repository_grounded_answer");
      return {
        route: "answer",
        runDisposition: "continue",
        reasonCodes,
      };
    }
    reasonCodes.push("direct_knowledge_answer");
    return {
      route: "answer",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (needsRepositoryGrounding(taskAnalysis, message)) {
    reasonCodes.push("repository_grounded_answer");
    return {
      route: "answer",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  reasonCodes.push("direct_knowledge_answer");
  return {
    route: "answer",
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

  // Structured review is button/CLI-prep only (host markers). Free-form
  // "code review" questions stay normal diagnose/answer — never force findings.
  const structuredReview = looksLikeCodeReviewRequest(message);
  if (isDiagnosisIntent(primary) || structuredReview) {
    reasonCodes.push("diagnosis_readonly");
    if (structuredReview) {
      reasonCodes.push("review_pipeline_required");
      reasonCodes.push("review_findings_structured");
    }
    return {
      route: "diagnose",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  if (looksLikeAgentVerificationRequest(message)) {
    reasonCodes.push("verification_run_requested");
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
      route: "answer",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  reasonCodes.push("direct_knowledge_answer");
  return {
    route: "answer",
    runDisposition: "continue",
    reasonCodes,
  };
}
