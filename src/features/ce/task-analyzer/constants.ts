import { TaskIntent } from "../intent";
import type { TaskConstraintKind, TaskRisk } from "./types";

/**
 * TASK COMPLEXITY PATTERNS
 */

const CONNECTOR_PATTERN =
  /\b(?:and|then|also|after\s+that|next|followed\s+by|as\s+well\s+as|along\s+with)\b/gi;

const ACTION_PATTERN =
  /\b(?:implement|build|create|add|fix|resolve|repair|migrate|refactor|rewrite|convert|integrate|configure|optimize|redesign|replace|remove|delete|update|generate|document|deploy|test|validate|install|upgrade|scaffold)\b/gi;

const FILE_REFERENCE_PATTERN =
  /[`'"]?((?:(?:[a-zA-Z]:[\\/])|(?:\.{0,2}[\\/])|(?:[a-zA-Z0-9_-]+[\\/]))*[a-zA-Z0-9_.-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|kts|cs|cpp|cc|cxx|c|h|hpp|rb|php|swift|scala|sql|graphql|json|jsonl|ya?ml|toml|xml|md|mdx|css|scss|sass|less|html|vue|svelte|sh|bash|tf|proto))[`'"]?/gi;

const BROAD_SCOPE_PATTERN =
  /\b(?:entire|whole|full)\s+(?:repository|repo|project|application|app|codebase|workspace|monorepo|package|module|service)|\b(?:repository-wide|repo-wide|project-wide|workspace-wide|system-wide|end-to-end|across all packages|across the codebase|throughout the project)\b/i;

const MULTI_PACKAGE_PATTERN =
  /\b(?:monorepo|workspace|multiple packages|all packages|every package|cross-package|cross-project|multiple services|all services|microservices)\b/i;

const ARCHITECTURE_PATTERN =
  /\b(?:architecture|architectural|infrastructure|distributed system|event-driven|microservices|orchestration|pipeline|state machine|dependency graph)\b/i;

const INTEGRATION_PATTERN =
  /\b(?:integration|integrate|webhook|oauth|sso|third-party|external api|payment gateway|message queue|kafka|rabbitmq|salesforce|stripe)\b/i;

const CONCURRENCY_PATTERN =
  /\b(?:concurrency|concurrent|parallel|threading|threads|race condition|deadlock|async pipeline|worker pool|distributed lock|semaphore|mutex)\b/i;

const MIGRATION_PATTERN =
  /\b(?:migrate|migration|port|major version upgrade|breaking change|backward compatibility|data migration|schema migration|framework migration)\b/i;

const DATA_PATTERN =
  /\b(?:database|schema|migration|backfill|data transformation|data loss|transaction|rollback|replication|database index|foreign key)\b/i;

const SECURITY_PATTERN =
  /\b(?:authentication|authorization|security|permissions|oauth|jwt|cve|vulnerabilit(?:y|ies)|encryption|credentials|secrets|access control)\b/i;

const PERFORMANCE_PATTERN =
  /\b(?:performance|optimize|optimization|latency|throughput|memory leak|bundle size|code splitting|caching|big[- ]?o|query performance)\b/i;

const VERIFICATION_PATTERN =
  /\b(?:tests?|unit tests?|integration tests?|e2e|lint|build|typecheck|type check|ci|continuous integration|benchmark|regression test|validate|verification)\b/gi;

const SIMPLE_TASK_PATTERN =
  /\b(?:rename|format|prettier|fix typo|update comment|change text|remove import|sort imports|single file|one file|small change|localized change)\b/i;

/**
 * TASK CLARITY PATTERNS
 */

const EXPLICIT_ACTION_PATTERN =
  /\b(?:fix|resolve|repair|implement|add|build|create|update|modify|remove|delete|refactor|restructure|optimize|migrate|convert|rewrite|configure|install|upgrade|review|audit|analyze|diagnose|investigate|explain|compare|document|test|format|style|generate|deploy|validate)\b/i;

const EXPLICIT_OUTCOME_PATTERN =
  /\b(?:bug|error|failure|failing tests?|feature|endpoint|integration|performance|latency|memory|security|vulnerability|documentation|readme|tests?|coverage|migration|schema|dependency|dependencies|configuration|config|layout|component|api|database|logs?|trace|pipeline|build|authentication|authorization)\b/i;

const VAGUE_ACTION_PATTERN =
  /\b(?:improve|handle|change|update|modify|work on|take care of|deal with|do something|make better|look at|check this|fix this|help with|work with)\b/i;

const AMBIGUOUS_REFERENCE_PATTERN =
  /\b(?:this|that|it|these|those|here|the above|the attached|the selected one|same thing)\b/i;

const EXPLICIT_CONSTRAINT_PATTERN =
  /\b(?:do not|don't|dont|never|only|must|without|keep|preserve|avoid|required to|make sure)\b/i;

const CLEAR_SHORT_COMMAND_PATTERN =
  /^(?:run\s+(?:the\s+)?tests?|run\s+(?:the\s+)?build|run\s+(?:the\s+)?linter|format\s+(?:this|the)\s+file|review\s+(?:this|the)\s+(?:diff|pr|patch)|explain\s+(?:this|the)\s+(?:file|function|code)|fix\s+(?:the\s+)?failing\s+tests?|update\s+(?:the\s+)?readme)[.!]?$/i;

/**
 * TASK SCOPE PATTERNS
 */

const WORKSPACE_SCOPE_PATTERN =
  /\b(?:entire|whole|all)\s+(?:monorepo|workspace)|\b(?:monorepo-wide|workspace-wide|all packages|every package|across packages|cross-package|multiple packages|all projects|cross-project)\b/i;

const REPOSITORY_SCOPE_PATTERN =
  /\b(?:entire|whole|full|all)\s+(?:repository|repo|project|application|app|codebase)|\b(?:repository-wide|repo-wide|project-wide|application-wide|app-wide|codebase-wide|across the repository|throughout the project)\b/i;

const PACKAGE_SCOPE_PATTERN =
  /\b(?:entire|whole|full|all)\s+(?:package|module|library|service)|\b(?:package-wide|module-wide|library-wide|service-wide|within this package|across this module)\b/i;

const MULTI_FILE_SCOPE_PATTERN =
  /\b(?:multiple|several|all affected)\s+files?\b|\bacross\s+(?:these|the)\s+files?\b|\bevery\s+file\s+in\b/i;

const LOCAL_SCOPE_PATTERN =
  /\b(?:this|the selected|current|single|one)\s+(?:file|function|method|class|component|module|directory|folder)\b/i;

/**
 * TASK CONSTRAINT PATTERNS
 */

const CONSTRAINT_PATTERNS = [
  {
    kind: "prohibition",
    pattern: /\b(?:do not|don't|dont|never)\b[^.!?;\n]{1,180}/gi,
    confidence: 0.95,
  },
  {
    kind: "restriction",
    pattern: /\b(?:only|without|avoid|no)\b[^.!?;\n]{1,180}/gi,
    confidence: 0.85,
  },
  {
    kind: "requirement",
    pattern:
      /\b(?:must|has to|have to|required to|make sure|ensure that)\b[^.!?;\n]{1,180}/gi,
    confidence: 0.9,
  },
  {
    kind: "preservation",
    pattern:
      /\b(?:keep|preserve|maintain|retain|do not break|don't break|remain compatible)\b[^.!?;\n]{1,180}/gi,
    confidence: 0.9,
  },
  {
    kind: "technology",
    pattern:
      /\b(?:use|using|with)\s+(?:typescript|javascript|python|java|go|rust|react|vue|angular|svelte|next\.?js|express|fastify|prisma|drizzle|tailwind|docker|terraform|kubernetes)\b[^.!?;\n]{0,120}/gi,
    confidence: 0.8,
  },
] as const satisfies readonly {
  kind: TaskConstraintKind;
  pattern: RegExp;
  confidence: number;
}[];

const SCOPE_CONSTRAINT_PATTERNS = [
  {
    kind: "scope",
    pattern:
      /\b(?:only modify|only change|only edit|limit changes to|restrict changes to)\b[^.!?;\n]{1,180}/gi,
    confidence: 0.97,
  },
  {
    kind: "scope",
    pattern:
      /\b(?:single file|one file|this file only|selected file only|do not touch other files|don't touch other files)\b[^.!?;\n]{0,100}/gi,
    confidence: 0.95,
  },
] as const satisfies readonly {
  kind: TaskConstraintKind;
  pattern: RegExp;
  confidence: number;
}[];

const VERIFICATION_CONSTRAINT_PATTERNS = [
  {
    kind: "verification",
    pattern:
      /\b(?:all tests must pass|keep tests passing|do not break tests|don't break tests|run the tests|verify the build|build must pass|lint must pass|no lint errors)\b[^.!?;\n]{0,120}/gi,
    confidence: 0.95,
  },
  {
    kind: "verification",
    pattern:
      /\b(?:without adding tests|do not add tests|don't add tests|skip tests|do not run tests|don't run tests)\b[^.!?;\n]{0,120}/gi,
    confidence: 0.93,
  },
] as const satisfies readonly {
  kind: TaskConstraintKind;
  pattern: RegExp;
  confidence: number;
}[];

/**
 * TASK RISK PATTERNS
 */

const RISK_PATTERNS = [
  {
    pattern: /\brm\s+-rf\b|\bformat\s+(?:disk|drive)\b/i,
    score: 7,
    risk: "critical",
    evidence: "A destructive filesystem command was detected.",
    requiresAct: true,
  },
  {
    pattern: /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i,
    score: 7,
    risk: "critical",
    evidence: "A destructive database operation was detected.",
    requiresAct: true,
  },
  {
    pattern: /\bdelete\s+from\b(?![^;\n]*\bwhere\b)/i,
    score: 7,
    risk: "critical",
    evidence: "A potentially unbounded database deletion was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:deploy|release|publish|push)\b[^.!?;\n]{0,80}\bproduction\b|\bproduction\b[^.!?;\n]{0,80}\b(?:deploy|release|publish|push)\b/i,
    score: 6,
    risk: "critical",
    evidence: "A production deployment or release action was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:rotate|replace|delete|remove|revoke|expose|print|log)\b[^.!?;\n]{0,80}\b(?:credentials?|api keys?|private keys?|secrets?|tokens?)\b/i,
    score: 6,
    risk: "critical",
    evidence: "A credential mutation or exposure operation was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:payment|billing|stripe|checkout|invoice|refund|subscription)\b/i,
    score: 4,
    risk: "high",
    evidence: "Payment or billing functionality was detected.",
  },
  {
    pattern:
      /\b(?:authentication|authorization|oauth|sso|jwt|passwords?|permissions?|access control)\b/i,
    score: 4,
    risk: "high",
    evidence: "Authentication or authorization functionality was detected.",
  },
  {
    pattern:
      /\b(?:cve|vulnerabilit(?:y|ies)|sql injection|xss|csrf|command injection|remote code execution|privilege escalation)\b/i,
    score: 5,
    risk: "high",
    evidence: "An explicit security vulnerability was detected.",
  },
  {
    pattern:
      /\b(?:database migration|schema migration|data migration|backfill|alter table|drop column|rename column)\b/i,
    score: 4,
    risk: "high",
    evidence: "A database or data migration was detected.",
  },
  {
    pattern:
      /\b(?:terraform apply|kubectl apply|helm upgrade|cloudformation deploy)\b/i,
    score: 5,
    risk: "high",
    evidence: "An infrastructure mutation command was detected.",
    requiresAct: true,
  },
  {
    pattern:
      /\b(?:public api|breaking change|backward compatibility|api contract)\b/i,
    score: 3,
    risk: "medium",
    evidence: "A public API or compatibility boundary was detected.",
  },
  {
    pattern:
      /\b(?:dependency upgrade|major version|package upgrade|lockfile|peer dependency)\b/i,
    score: 2,
    risk: "medium",
    evidence: "A dependency compatibility change was detected.",
  },
  {
    pattern:
      /\b(?:ci\/cd|pipeline|dockerfile|kubernetes|terraform|deployment configuration)\b/i,
    score: 2,
    risk: "medium",
    evidence:
      "Build, deployment, or infrastructure configuration was detected.",
  },
] as const satisfies readonly {
  pattern: RegExp;
  score: number;
  risk: TaskRisk;
  evidence: string;
  requiresAct?: boolean;
}[];

const SAFE_CONSTRAINT_PATTERN =
  /\b(?:do not deploy|don't deploy|dont deploy|dry run|read-only|read only|do not apply|don't apply|do not execute|don't execute|without changing|no changes|plan only|explain only)\b/i;

/**
 * INTENT-BASED DEFAULTS
 */

const VERIFICATION_REQUIRED = [
  "bugfix",
  "feature",
  "refactor",
  "optimize",
  "test",
  "security",
  "scaffold",
  "migrate",
  "schema",
  "mock",
  "config",
  "dependency",
  "docs",
  "style",
  "format",
] as const satisfies readonly TaskIntent[];

const PLANNING_RECOMMENDED = [
  "feature",
  "refactor",
  "optimize",
  "security",
  "scaffold",
  "migrate",
  "schema",
  "config",
] as const satisfies readonly TaskIntent[];

const REPOSITORY_DEPENDENT = [
  "bugfix",
  "feature",
  "refactor",
  "optimize",
  "diagnose",
  "test",
  "audit",
  "review",
  "security",
  "trace",
  "migrate",
  "schema",
  "config",
  "dependency",
  "docs",
  "style",
  "format",
] as const satisfies readonly TaskIntent[];

export const TASK_ANALYZER_CONSTANTS = {
  ANALYSIS_PATTERNS: {
    CONNECTOR_PATTERN,
    ACTION_PATTERN,
    FILE_REFERENCE_PATTERN,
    BROAD_SCOPE_PATTERN,
    MULTI_PACKAGE_PATTERN,
    ARCHITECTURE_PATTERN,
    INTEGRATION_PATTERN,
    CONCURRENCY_PATTERN,
    MIGRATION_PATTERN,
    DATA_PATTERN,
    SECURITY_PATTERN,
    PERFORMANCE_PATTERN,
    VERIFICATION_PATTERN,
    SIMPLE_TASK_PATTERN,
  },

  CLARITY_PATTERNS: {
    EXPLICIT_ACTION_PATTERN,
    EXPLICIT_OUTCOME_PATTERN,
    VAGUE_ACTION_PATTERN,
    AMBIGUOUS_REFERENCE_PATTERN,
    EXPLICIT_CONSTRAINT_PATTERN,
    CLEAR_SHORT_COMMAND_PATTERN,
  },

  SCOPE_PATTERNS: {
    WORKSPACE_SCOPE_PATTERN,
    REPOSITORY_SCOPE_PATTERN,
    PACKAGE_SCOPE_PATTERN,
    MULTI_FILE_SCOPE_PATTERN,
    LOCAL_SCOPE_PATTERN,
  },

  CONSTRAINT_PATTERNS: {
    GENERAL: CONSTRAINT_PATTERNS,
    SCOPE: SCOPE_CONSTRAINT_PATTERNS,
    VERIFICATION: VERIFICATION_CONSTRAINT_PATTERNS,
  },

  RISK_PATTERNS: {
    DEFINITIONS: RISK_PATTERNS,
    SAFE_CONSTRAINT_PATTERN,
  },

  INTENT_DEFAULTS: {
    VERIFICATION_REQUIRED,
    PLANNING_RECOMMENDED,
    REPOSITORY_DEPENDENT,
  },
} as const;
