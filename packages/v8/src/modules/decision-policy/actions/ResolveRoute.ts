import type { RequestUnderstandingResult } from "../../request-understanding";
import { isWholeRequestReadOnlyConstraint } from "../../request-understanding/intent/isWholeRequestReadOnlyConstraint";

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
  /**
   * When true, skip the clarify early-return so unattended hosts
   * (automation / api) can continue with a best-effort route.
   */
  suppressClarification?: boolean;
}): RouteResolution {
  const { mode, understanding, message } = params;
  const { intent, taskAnalysis } = understanding;
  const primary = intent.classification.primaryTaskIntent;
  const interaction = intent.classification.interactionIntent;
  const reasonCodes: DecisionReasonCode[] = [];

  if (
    !params.suppressClarification &&
    requiresClarification(understanding, message, mode)
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
  if (interaction === "plan" || isExplicitPlanRequest(message)) {
    reasonCodes.push("explicit_plan_request");
    return {
      route: "plan",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  // Pasted console/runtime dumps without an explicit fix/implement ask should
  // diagnose first. Otherwise understanding often labels them bugfix+act and
  // the execute loop fails with no_mutation_performed after endless searching.
  // Keep this ahead of mutation-intent promotion so stack pastes stay read-only.
  if (looksLikePastedRuntimeErrorDump(message)) {
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  // Mutation must win over soft diagnosis labels and question-shaped phrasing
  // ("Edit docs/…", "Can you fix that?", "implement…?"). Previously
  // isDiagnosisIntent ran first and stripped apply_patch for edit/fix asks
  // that understanding classified as investigate_symptom / diagnose.
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

  if (isDiagnosisIntent(primary)) {
    reasonCodes.push("diagnosis_readonly");
    return {
      route: "diagnose",
      runDisposition: "continue",
      reasonCodes,
    };
  }

  // "Run the tests / what is failing" must not fall through to direct_answer
  // (zero tools). Diagnose grants run_readonly_command.
  if (looksLikeAgentVerificationRequest(message)) {
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
  if (looksLikeWorkspaceRuntimeSymptom(message)) {
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

  if (looksLikeAgentVerificationRequest(message)) {
    return false;
  }

  const { intent, taskAnalysis } = understanding;
  const materialFork = isMaterialCapabilityFork(understanding, message);

  // Agent mode: clear actionable mutation asks should execute even when
  // understanding marks soft ambiguity (avoids stalling "implement X" work).
  // Do NOT skip when alternatives fork read vs write (investigate vs fix).
  if (
    mode === "agent" &&
    looksLikeAgentMutationRequest(message) &&
    !isBareAmbiguousMutationAsk(message) &&
    !materialFork
  ) {
    return false;
  }

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

/**
 * Clarify when the fork changes what the agent is allowed to do (read vs write)
 * or confidence is too low to guess. Clear "Add app/error.tsx" / "implement X"
 * asks with soft ambiguity flags are not material forks.
 */
function isMaterialCapabilityFork(
  understanding: RequestUnderstandingResult,
  message = "",
): boolean {
  const { intent } = understanding;
  const classification = intent.classification;
  const flagged =
    intent.status === "clarification_required" ||
    intent.recommendsClarification ||
    classification.needsClarification;
  if (!flagged) {
    return false;
  }

  const intents = new Set<string>([
    classification.primaryTaskIntent,
    ...classification.alternatives.map((alternative) => alternative.intent),
  ]);
  const hasDiagnoseSide = [...intents].some(
    (value) => isDiagnosisIntent(value) || value === "question",
  );
  const hasMutateSide = [...intents].some((value) => isMutationIntent(value));
  if (hasDiagnoseSide && hasMutateSide) {
    return true;
  }

  const ambiguityQuestion =
    classification.taskHints?.ambiguityQuestion?.trim() ?? "";
  if (
    ambiguityQuestion.length > 0 &&
    /\b(?:investigate|diagnos(?:e|is)|look\s+into|explain)\b/i.test(
      ambiguityQuestion,
    ) &&
    /\b(?:fix|implement|patch|change|edit)\b/i.test(ambiguityQuestion)
  ) {
    return true;
  }

  // Medium/low confidence with an explicit clarify flag — ask instead of
  // collapsing to a tool-less answer or a guessed write grant. Skip when the
  // user already named a concrete path target (benchmark / IDE file asks).
  if (
    classification.confidence <
      DECISION_POLICY_THRESHOLDS.clarifyWhenFlaggedBelowConfidence
  ) {
    if (hasExplicitMutationPathTarget(message)) {
      return false;
    }
    return true;
  }

  return false;
}

/** True when the ask names a concrete workspace path (file or app/src tree). */
function hasExplicitMutationPathTarget(message: string): boolean {
  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length === 0) {
    return false;
  }

  // File with extension: app/error.tsx, src/components/Button.tsx
  if (
    /(?:^|[\s`'"(])(?:[\w@.+-]+\/)+[\w.@+-]+\.[A-Za-z][A-Za-z0-9]*\b/.test(
      text,
    )
  ) {
    return true;
  }

  // Common source roots without requiring an extension: app/about, src/hooks
  if (
    /(?:^|[\s`'"(])(?:app|src|packages?|tests?|lib|components)\/[\w./@+-]+/.test(
      text,
    )
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
  return /\b(write|add|update|create|draft|document|edit|replace|change|fix)\b/i.test(
    message,
  );
}

/**
 * Explicit whole-request read-only / no-edit constraints — never promote to
 * execute. Scoped constraints ("Do not refactor Tablet…") do not match.
 */
function isExplicitReadOnlyRequest(message: string): boolean {
  return isWholeRequestReadOnlyConstraint(message);
}

/**
 * Run/inspect the workspace test suite — not "how do I run tests" and not
 * "write new tests".
 */
export function looksLikeAgentVerificationRequest(message: string): boolean {
  if (isExplicitPlanRequest(message)) {
    return false;
  }

  // "Implement X so I can run tests" is a write request, not a test-run ask.
  if (looksLikeAgentMutationRequest(message)) {
    return false;
  }

  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length === 0) {
    return false;
  }

  if (
    /^(?:how\s+(?:do|does|did|can|should|would|to)|what\s+(?:is|are)\s+(?:the\s+)?(?:command|script|npm))/i.test(
      text,
    )
  ) {
    return false;
  }

  if (
    /\b(?:write|add|create|generate|implement)\b[\s\S]{0,48}\btests?\b/i.test(
      text,
    ) &&
    !/\b(?:run|execute|launch)\b/i.test(text)
  ) {
    return false;
  }

  return (
    /\b(?:run|execute|launch)\b[\s\S]{0,80}\b(?:the\s+)?(?:tests?|testes|specs?|suite|e2e|wdio)\b/i.test(
      text,
    ) ||
    /\b(?:which|what)\s+tests?\s+(?:are\s+)?(?:failing|passing|failed|passed)\b/i.test(
      text,
    ) ||
    /\b(?:failing|passing)\s+and\s+(?:passing|failing)\b/i.test(text) ||
    /\b(?:npm|pnpm|yarn|bun)\s+run\s+\S*test/i.test(text) ||
    /\bwdio\s+run\b/i.test(text) ||
    /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?test(?:\s|$|\?)/i.test(
      text,
    ) ||
    /\bcan you test\b/i.test(text)
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
    /(?:^|\b)(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|i\s+want\s+you\s+to\s+|i\s+need\s+you\s+to\s+|i\s+need\s+|we\s+need\s+to\s+|let(?:'s|\s+us)\s+)?(?:start\s+(?:the\s+)?implem(?:entation|netation)|implement|build(?!\s+(?:logs?|errors?|output|failures?|status|artifacts?)\b)|create|design|develop|write|add|edit|fix|resolve|repair|patch|migrate|refactor|rewrite|convert|integrate|configure|optimize|redesign|replace|remove|delete|update|modify|change|generate|scaffold|install|upgrade)\b/i.test(
      text,
    ) ||
    // Imperative docs/code edits: "Edit docs/foo.md only: …"
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?edit\b/i.test(text) ||
    // Seeded bugfix phrasing: "X uses Y. Change it to Z." / "says Foo. Fix it to Bar."
    /\b(?:change|fix|update|set|switch|replace)\b[\s\S]{0,40}\bto\b/i.test(
      text,
    ) ||
    /\bi\s+need\s+(?:to\s+design\s+|to\s+create\s+|to\s+build\s+|an?\s+|the\s+)*(?:api|endpoint|route)\b/i.test(
      text,
    )
  );
}

/**
 * Soft runtime symptoms (stuck loading, hang after starting a server) that
 * are not strong enough for workspace_bug_execute, but must not become
 * tool-less direct_answer in Agent mode.
 */
function looksLikeWorkspaceRuntimeSymptom(message: string): boolean {
  if (looksLikeAgentMutationRequest(message) || isExplicitPlanRequest(message)) {
    return false;
  }

  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length < 8) {
    return false;
  }

  const hasSymptom =
    /\b(?:loading\.{0,3}|spinner|hang(?:s|ing)?|stuck|blank\s+page|splash|never\s+(?:finishes|loads|renders)|keeps?\s+loading)\b/i.test(
      text,
    ) ||
    /\b(?:not\s+loading|won'?t\s+load|doesn'?t\s+load|fail(?:s|ed)?\s+to\s+load)\b/i.test(
      text,
    );

  if (!hasSymptom) {
    return false;
  }

  const hasWorkspaceAnchor =
    /\b(?:server|localhost|npx|http|https|page|ui|app|browser|preview|vite|next|webpack|dev\s*server)\b/i.test(
      text,
    ) ||
    /\bhttps?:\/\/localhost(?::\d+)?\//i.test(text);

  return hasWorkspaceAnchor;
}

/**
 * Chrome/Node-style console dumps pasted without "please fix". These need
 * diagnosis (and often config guidance), not a forced write grant.
 */
function looksLikePastedRuntimeErrorDump(message: string): boolean {
  if (looksLikeAgentMutationRequest(message) || isExplicitPlanRequest(message)) {
    return false;
  }

  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length < 12) {
    return false;
  }

  const hasFileLine =
    /\b[\w./@+-]+\.(?:js|jsx|ts|tsx|mjs|cjs|vue|svelte|css):\d+(?::\d+)?\b/i.test(
      text,
    );
  if (!hasFileLine) {
    return false;
  }

  const hasStackFrame =
    /\t@\t/.test(text) ||
    /\n\s+at\s+\S+/.test(text) ||
    /\bIs\t@\t/.test(text) ||
    /\b@\s+[\w./+-]+\.(?:js|jsx|ts|tsx|mjs|cjs):\d+/i.test(text);
  const hasConsoleObjectDump = /\bObject\b/.test(text);
  const multiLine = text.split(/\n/).filter((line) => line.trim().length > 0)
    .length >= 2;

  return hasStackFrame || hasConsoleObjectDump || multiLine;
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
    /\b(?:this|the|current)\s+(?:project|repo|repository|codebase|workspace|code|suite|framework|app|application)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (
    /\b(?:in|across|throughout|within|of|on|for)\s+(?:this|the|current)\s+(?:project|repo|repository|codebase|workspace|suite|framework|app|application)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  // Deictic workspace asks without an explicit noun:
  // "Is headless supported in this?", "does this support X", "configured here?"
  if (
    /\b(?:in|for|within|across|throughout|on|with)\s+this\b/i.test(text) ||
    /\b(?:in|for|within)\s+here\b/i.test(text) ||
    /\b(?:supported|configured|enabled|available|implemented)\s+(?:in|for|by|on)\s+(?:this|here)\b/i.test(
      text,
    ) ||
    /\b(?:does|is|can|will)\s+(?:this|it)\s+(?:support|have|use|enable|include|allow|offer)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  // Follow-ups about implementing / enabling something already under discussion
  // ("If I have to implement it?", "make headless and run in linux").
  if (
    /\b(?:implement|enable|add|configure|set\s*up|turn\s+on|apply)\b[\s\S]{0,48}\b(?:it|this|that|them|headless|support|feature|change|fix|patch)\b/i.test(
      text,
    ) ||
    /\b(?:how\s+(?:do|can|should)\s+i|what\s+should\s+i\s+do|how\s+to|how\s+can\s+i)\b/i.test(
      text,
    ) ||
    /\b(?:make|get)\s+(?:it|this|that|headless)\b[\s\S]{0,48}\b(?:work|run|supported|enabled)\b/i.test(
      text,
    ) ||
    /\b(?:make|enable|run)\s+headless\b/i.test(text) ||
    /\b(?:run|running|execute|executing)\b[\s\S]{0,40}\b(?:on|in)\s+(?:linux|ubuntu|debian|docker|ci|ci\/cd|github\s+actions)\b/i.test(
      text,
    ) ||
    /\b(?:on|in)\s+(?:linux|ubuntu|debian|docker|ci|ci\/cd|github\s+actions)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (
    /\b(?:test cases?|specs?|page objects?|how to run|can you test|architecture|redundant code|working tree|file map|source files?)\b/i.test(
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
