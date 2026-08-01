import { IntentRule } from "../../types";

const INTENT_PATTERNS: IntentRule[] = [
  {
    intent: "bugfix",
    pattern:
      /\b(?:fix|resolve|repair|patch|correct)\b.*\b(?:bug|issue|error|defect|crash|exception|failing tests?|regression|broken behavior)\b/i,
    confidence: 0.88,
  },
  {
    intent: "feature",
    pattern:
      /\b(?:implement|add|build|create)\b.*\b(?:new feature|endpoint|capability|integration|functionality)\b/i,
    confidence: 0.86,
  },
  {
    intent: "refactor",
    pattern:
      /\b(?:refactor|restructure|reorganize|simplify)\b|\bextract\b.*\b(?:function|method|component|module|class|logic)\b/i,
    confidence: 0.87,
  },
  {
    intent: "optimize",
    pattern:
      /\b(?:optimize|speed up)\b|\b(?:improve|reduce)\b.*\b(?:performance|latency|memory usage|bundle size|complexity|runtime)\b/i,
    confidence: 0.84,
  },
  {
    intent: "diagnose",
    pattern:
      /\b(?:diagnose|investigate|troubleshoot)\b|\bfind\s+(?:the\s+)?root\s+cause\b|\bwhy\s+(?:is|does|did|has|was)\b/i,
    confidence: 0.84,
  },
  {
    intent: "test",
    pattern:
      /\b(?:write|add|create|generate|run|improve)\b.*\b(?:tests?|unit tests?|integration tests?|e2e tests?|test coverage|test suite)\b/i,
    confidence: 0.86,
  },
  {
    intent: "audit",
    pattern:
      /\b(?:audit|inspect)\b.*\b(?:codebase|repository|project|dependencies|imports|exports)\b|\b(?:find|remove|clean up)\b.*\b(?:dead code|unused\s+(?:deps|dependencies|imports|files|exports))\b/i,
    confidence: 0.84,
  },
  {
    intent: "review",
    pattern:
      /\b(?:review|critique)\b.*\b(?:diff|pr|pull request|patch|commit|code|changes)\b|\bgenerate\b.*\bpr\s+(?:description|summary)\b/i,
    confidence: 0.86,
  },
  {
    intent: "security",
    pattern:
      /\b(?:security audit|security review|cve|vulnerabilit(?:y|ies)|xss|sql injection|command injection|sanitize inputs?|exploit|mitigate)\b/i,
    confidence: 0.83,
  },
  {
    intent: "trace",
    pattern:
      /\b(?:analyze|parse|investigate|inspect|read)\b.*\b(?:logs?|traces?|execution trace|session logs?|jsonl)\b/i,
    confidence: 0.87,
  },
  {
    intent: "scaffold",
    pattern:
      /\b(?:scaffold|bootstrap)\b.*\b(?:project|application|app|module|service)?\b|\b(?:generate|create)\b.*\b(?:boilerplate|starter project|initial structure)\b/i,
    confidence: 0.87,
  },
  {
    intent: "migrate",
    pattern:
      /\b(?:migrate|port)\b.*\b(?:code|project|application|service|module|from|to)\b|\b(?:convert|rewrite)\b.*\b(?:from|to)\b/i,
    confidence: 0.85,
  },
  {
    intent: "schema",
    pattern:
      /\b(?:create|update|modify|generate|design)\b.*\b(?:database schema|db schema|sql schema|prisma model|drizzle schema|mongoose schema|database migration|sql migration)\b/i,
    confidence: 0.86,
  },
  {
    intent: "mock",
    pattern:
      /\b(?:generate|create|write|add)\b.*\b(?:mock data|fake data|test fixtures?|seed script|seed data|stubs?)\b/i,
    confidence: 0.87,
  },
  {
    intent: "config",
    pattern:
      /\b(?:configure|set up|setup|write|update|create)\b.*\b(?:ci\/cd|pipeline|dockerfile|github actions?|gitlab ci|webpack|vite|tsconfig|eslint config|prettier config)\b/i,
    confidence: 0.85,
  },
  {
    intent: "dependency",
    pattern:
      /\b(?:npm|yarn|pnpm|bun)\s+(?:install|add|remove|upgrade|update)\b|\b(?:install|add|remove|update|upgrade|resolve)\b.*\b(?:package|dependency|dependencies|peer dependencies)\b/i,
    confidence: 0.88,
  },
  {
    intent: "docs",
    pattern:
      /\b(?:write|update|create|generate|improve)\b.*\b(?:readme|docs|documentation|jsdoc|docstrings?|changelog|mdx)\b/i,
    confidence: 0.87,
  },
  {
    intent: "style",
    pattern:
      /\b(?:style|redesign|restyle|make)\b.*\b(?:component|page|layout|responsive|accessible)\b|\b(?:add|update|fix)\b.*\b(?:css|tailwind classes?|responsive layout|animations?|framer motion)\b/i,
    confidence: 0.82,
  },
  {
    intent: "format",
    pattern:
      /\b(?:format code|format this|run prettier|apply prettier|fix eslint|run eslint|fix lint|lint this|run the linter)\b/i,
    confidence: 0.89,
  },
  {
    intent: "question",
    pattern:
      /^(?:how\s+(?:do|does|did|can|should|would)|why\s+(?:is|does|did|has|was)|what\s+(?:is|are|does)|explain\b|compare\b)/i,
    confidence: 0.8,
  },
];

const ACKNOWLEDGEMENT_ONLY_PATTERN =
  /^(?:hi|hello|hey|thanks|thank you|ok|okay|got it|makes sense|understood|sounds good)[\s.!?,]*$/i;

/**
 * Explicitly requests planning without implementation.
 */
const PLAN_PATTERN =
  /\b(?:create|give|provide|write|prepare|make)\b.*\b(?:implementation plan|migration plan|refactoring plan|debugging plan|step-by-step plan|approach|strategy)\b|\bplan\s+only\b|\bdo not implement\b|\bdon't implement\b|\bwithout implementing\b/i;

/**
 * Explicitly prohibits code or file modifications.
 */
const NO_CHANGE_PATTERN =
  /\b(?:do not|don't|dont|without)\s+(?:edit|change|modify|fix|implement|apply|write|update|remove|refactor|touch)\b|\b(?:explain|review|diagnose|analyze|investigate)\s+only\b|\bno\s+(?:code|file)\s+changes\b|\bread[- ]only\b/i;

/**
 * Question-shaped requests that normally expect a response without mutation.
 */
const QUESTION_PATTERN =
  /^(?:can you\s+)?(?:how|why|what|when|where|which)\b|^(?:please\s+)?(?:explain|compare|describe|clarify|tell me)\b/i;

/**
 * Explicit modification language.
 */
const ACT_PATTERN =
  /\b(?:fix|resolve|repair|patch|correct|implement|add|build|create|update|modify|remove|delete|refactor|restructure|optimize|migrate|convert|rewrite|configure|install|upgrade|format|generate|scaffold|bootstrap|apply)\b/i;

/**
 * Read-only investigation language.
 */
const READ_ONLY_PATTERN =
  /\b(?:review|audit|inspect|analyze|diagnose|investigate|troubleshoot|trace|explain|compare|identify|find the root cause)\b/i;

export const PATTERNS = {
  INTENT_PATTERNS,
  ACKNOWLEDGEMENT_ONLY_PATTERN,
  PLAN_PATTERN,
  NO_CHANGE_PATTERN,
  QUESTION_PATTERN,
  ACT_PATTERN,
  READ_ONLY_PATTERN,
};
