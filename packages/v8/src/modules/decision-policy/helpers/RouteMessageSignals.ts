import {
  isWholeRequestReadOnlyConstraint,
} from "../../request-understanding";
import {
  DECISION_POLICY_THRESHOLDS,
} from "../rules";
import {
  isConcreteLocalizedMutationAsk,
} from "./ClassifySharedScopeRepair";
import {
  looksLikeWorkspaceBugReport,
} from "./LooksLikeWorkspaceBugReport";


/**
 * Structured git review is opt-in only: VS Code Review button / CLI prep.
 * Matches host-injected markers — not free-form "code review" chat phrasing.
 */
export function looksLikeCodeReviewRequest(message: string): boolean {
  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length === 0) {
    return false;
  }

  if (/\bemit_review_finding\b/i.test(text)) {
    return true;
  }

  if (/^#\s*Review prep\b/m.test(text) || /\bReview prep\s*\(/i.test(text)) {
    return true;
  }

  return false;
}


/** True when the ask names a concrete workspace path (file or app/src tree). */
export function hasExplicitMutationPathTarget(message: string): boolean {
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
export function isBareAmbiguousMutationAsk(message: string): boolean {
  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  // short alone is not bare when the outcome/target is concrete.
  if (
    isConcreteLocalizedMutationAsk(text) ||
    hasExplicitMutationPathTarget(text)
  ) {
    return false;
  }
  if (text.length < DECISION_POLICY_THRESHOLDS.bareMutationAskMaxChars) {
    return true;
  }
  return /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:fix|update|change|do|implement|handle)\s+(?:it|this|that)\b[.!?]*$/i.test(
    text,
  );
}


export function hasResolvedClarification(message: string): boolean {
  return /\nClarification:\s*\S+/i.test(message);
}


export function isHardPlanOnlyRequest(message: string): boolean {
  return /\bplan\s+only\b/i.test(
    message.replace(/\nClarification:\s*[\s\S]*$/i, ""),
  );
}


export function isSoftExplicitPlanRequest(message: string): boolean {
  return /\b(make\s+a\s+plan|create\s+a\s+plan|write\s+a\s+plan|propose\s+a\s+plan)\b/i.test(
    message.replace(/\nClarification:\s*[\s\S]*$/i, ""),
  );
}


export function isExplicitPlanRequest(message: string): boolean {
  return isHardPlanOnlyRequest(message) || isSoftExplicitPlanRequest(message);
}


export function looksLikeDocsMutation(message: string): boolean {
  return /\b(write|add|update|create|draft|document|edit|replace|change|fix)\b/i.test(
    message,
  );
}


/**
 * Explicit whole-request read-only / no-edit constraints — never promote to
 * execute. Scoped constraints ("Do not refactor Tablet…") do not match.
 */
export function isExplicitReadOnlyRequest(message: string): boolean {
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
export function looksLikeAgentMutationRequest(message: string): boolean {
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
    // Style / UX asks: "can you make it professional and elegant"
    /\bmake\s+(?:it|this|that|the)\b/i.test(text) ||
    looksLikeContinuationArtifactRequest(text) ||
    // Imperative docs/code edits: "Edit docs/foo.md only: …"
    /^(?:please\s+|can\s+you\s+|could\s+you\s+)?edit\b/i.test(text) ||
    // Seeded bug fix phrasing: "X uses Y. Change it to Z." / "says Foo. Fix it to Bar."
    /\b(?:change|fix|update|set|switch|replace)\b[\s\S]{0,40}\bto\b/i.test(
      text,
    ) ||
    /\bi\s+need\s+(?:to\s+design\s+|to\s+create\s+|to\s+build\s+|an?\s+|the\s+)*(?:api|endpoint|route)\b/i.test(
      text,
    )
  );
}


function looksLikeContinuationArtifactRequest(text: string): boolean {
  if (
    !/\b(?:i|we)\s+need\b/i.test(text) ||
    !/\b(?:also|too|as\s+well|remaining|missing|left|still)\b/i.test(text)
  ) {
    return false;
  }

  return /\b(?:fields?|components?|modules?|files?|exports?|helpers?|hooks?|types?|schemas?|package|builder|renderer|formbuilder|formrenderer|provider|adapter|tests?)\b/i.test(
    text,
  );
}


/**
 * Soft runtime symptoms (stuck loading, hang after starting a server) that
 * are not strong enough for workspace_bug_execute, but must not become
 * tool-less direct_answer in Agent mode.
 */
export function looksLikeWorkspaceRuntimeSymptom(message: string): boolean {
  if (looksLikeAgentMutationRequest(message) || isExplicitPlanRequest(message)) {
    return false;
  }

  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length < DECISION_POLICY_THRESHOLDS.runtimeSymptomMinChars) {
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
export function looksLikePastedRuntimeErrorDump(message: string): boolean {
  if (looksLikeAgentMutationRequest(message) || isExplicitPlanRequest(message)) {
    return false;
  }

  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length < DECISION_POLICY_THRESHOLDS.pastedRuntimeDumpMinChars) {
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
 * Structured unit-test failure pastes (vitest / jest / Failed Tests N).
 * Soft Officer act+bugfix may execute these even when confidence is 0.60–0.69.
 */
export function looksLikePastedTestFailureReport(message: string): boolean {
  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length < DECISION_POLICY_THRESHOLDS.pastedTestFailureMinChars) {
    return false;
  }
  return (
    /Failed Tests?\s+\d+/i.test(text) ||
    /\bFAIL\s+\S+\.(?:test|spec)\.[jt]sx?\b/i.test(text) ||
    /\bAssertionError\b/.test(text) ||
    /⎯+.*Failed Tests/i.test(text)
  );
}


/**
 * Ask/agent questions about the open workspace that understanding may still
 * classify as generic "question" with unknown scope.
 */
export function looksLikeWorkspaceGroundedRequest(message: string): boolean {
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
