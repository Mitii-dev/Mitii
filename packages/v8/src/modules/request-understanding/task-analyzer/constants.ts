import {
  ACTION_AT_START_PATTERN,
  ACKNOWLEDGEMENT_PATTERN,
  LEADING_CONNECTOR_PATTERN,
  NEGATED_ACTION_PATTERN,
  OUTCOME_ACTION_PATTERN,
  OUTCOME_CONNECTOR_PATTERN,
  PLANNING_RECOMMENDED,
  POLITE_PREFIX_PATTERN,
  QUESTION_PREFIX_PATTERN,
  REPOSITORY_DEPENDENT,
  SENTENCE_BOUNDARY_PATTERN,
  TRAILING_CONNECTOR_PATTERN,
  VERIFICATION_REQUIRED,
} from "./constantsIntentOutcome";
import {
  CONSTRAINT_PATTERNS,
  RISK_PATTERNS,
  SAFE_CONSTRAINT_PATTERN,
  SCOPE_CONSTRAINT_PATTERNS,
  VERIFICATION_CONSTRAINT_PATTERNS,
} from "./constantsConstraintsRisk";
import {
  AT_PATH_REFERENCE_PATTERN,
  ERROR_SYMBOL_REFERENCE_PATTERN,
  FILE_REFERENCE_PATTERN,
  FOLDER_REFERENCE_PATTERN,
  LOOKS_LIKE_FILE_PATTERN,
  PACKAGE_FOLDER_PATTERN,
  SYMBOL_REFERENCE_PATTERN,
} from "./constantsReferences";

export { TASK_ANALYZER_SOURCE_FILE_EXTENSIONS } from "./constantsReferences";

/**
 * TASK COMPLEXITY PATTERNS
 */

const CONNECTOR_PATTERN =
  /\b(?:and|then|also|after\s+that|next|followed\s+by|as\s+well\s+as|along\s+with)\b/gi;

const ACTION_PATTERN =
  /\b(?:implement|build|create|add|fix|resolve|repair|migrate|refactor|rewrite|convert|integrate|configure|optimize|redesign|replace|remove|delete|update|generate|document|deploy|test|validate|install|upgrade|scaffold)\b/gi;

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
  /\b(?:rename|format|prettier|fix typo|update comment|change text|change(?:\s+the)?\s+(?:nav|label|button|link|title|heading|menu)|rename(?:\s+the)?\s+(?:nav|label|button|link|title)|remove import|sort imports|single file|one file|small change|localized change)\b/i;

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

/**
 * Repository scope = the *work spans* the repo, not that something merely
 * exists "in this codebase" / concerns "the app". Locative and deictic
 * phrases alone must not inflate scope (they false-trigger plan gates).
 *
 * Explicit restructure/reorganize of the project or folder layout *is*
 * repo-spanning work even without "entire/whole/full".
 */
const REPOSITORY_SCOPE_PATTERN =
  /\b(?:entire|whole|full|all)\s+(?:repository|repo|project|application|app|codebase)\b|\b(?:repository-wide|repo-wide|project-wide|application-wide|app-wide|codebase-wide)\b|\bacross\s+(?:the\s+)?(?:repository|repo|codebase|project|application|app)\b|\bthroughout\s+(?:the\s+)?(?:repository|repo|codebase|project|application|app)\b|\b(?:restructure|reorganize)\s+(?:this|the)\s+(?:project|repo|repository|codebase|application|app)\b|\b(?:folder|directory)\s+(?:restructure|reorganization|reorg)\b|\brestructure\s+(?:the\s+)?(?:folder|directory)\s+(?:structure|layout)\b/i;

const PACKAGE_SCOPE_PATTERN =
  /\b(?:entire|whole|full|all)\s+(?:package|module|library|service)|\b(?:package-wide|module-wide|library-wide|service-wide|within this package|across this module)\b/i;

const MULTI_FILE_SCOPE_PATTERN =
  /\b(?:multiple|several|all affected)\s+files?\b|\bacross\s+(?:these|the)\s+files?\b|\bevery\s+file\s+in\b/i;

const LOCAL_SCOPE_PATTERN =
  /\b(?:this|the selected|current|single|one)\s+(?:file|function|method|class|component|module|directory|folder)\b/i;

const COMPLEXITY_SCORE_THRESHOLDS = {
  VERY_COMPLEX: 10,
  COMPLEX: 6,
  MODERATE: 3,
} as const;

const RISK_SCORE_THRESHOLDS = {
  CRITICAL: 10,
  HIGH: 6,
  MEDIUM: 3,
} as const;

export const TASK_ANALYZER_CONSTANTS = {
  THRESHOLDS: {
    LONG_DESCRIPTION_CHARACTERS: 500,
    CONNECTORS: {
      MANY: 4,
      SEVERAL: 2,
    },
    ACTIONS: {
      MANY: 4,
      MULTIPLE: 2,
    },
    FILE_REFERENCES: {
      MANY: 6,
      MULTIPLE: 3,
      EXPLICIT: 1,
    },
    VERIFICATION_ACTIVITIES: {
      MULTIPLE: 3,
      EXPLICIT: 1,
    },
    SIMPLE_TASK_MAX_SCORE: 3,
    COMPLEXITY: COMPLEXITY_SCORE_THRESHOLDS,
    RISK: RISK_SCORE_THRESHOLDS,
    CLARITY: {
      INTENT_LOW: 0.6,
      INTENT_HIGH: 0.8,
      CONFIDENCE_MARGIN_LOW: 0.15,
      STRONG_UNCLEAR: 0.88,
    },
    SCOPE: {
      WORKSPACE: 0.97,
      REPOSITORY: 0.95,
      PACKAGE: 0.9,
      MULTI_FILE: 0.88,
      LOCAL: 0.8,
      UNKNOWN: 0.3,
      SINGLE_TARGET: 0.9,
      MULTI_TARGET: 0.92,
      PACKAGE_TARGET: 0.95,
      PACKAGE_FOLDER: 0.78,
    },
    RISK_INTENTS: {
      HIGH: ["security", "migrate", "schema", "dependency", "config"] as const,
      MEDIUM: ["feature", "refactor", "optimize", "scaffold"] as const,
    },
    RISK_SCOPES: {
      WORKSPACE: 3,
      REPOSITORY: 2,
      MULTI_LOCATION: 1,
    },
    READ_ONLY_RISK_REDUCTION_FACTOR: 0.35,
    READ_ONLY_RISK_REDUCTION_MAX: 3,
    EMPTY_CONSTRAINT_CONFIDENCE: 0.5,
    EMPTY_OUTCOME_CONFIDENCE: 0.5,
    DEFAULT_RISK_CONFIDENCE: 0.65,
    BASE_RISK_CONFIDENCE: 0.7,
    SIGNAL_NORMALIZATION: {
      COMPLEXITY_DIVISOR: 3,
      RISK_DIVISOR: 7,
    },
    COMPLEXITY_CONFIDENCE: {
      EMPTY_SIMPLE: 0.65,
      EMPTY_OTHER: 0.55,
      BASE: 0.65,
      PER_SIGNAL: 0.04,
      MAX_BONUS: 0.25,
    },
    TARGET_SIGNAL_WEIGHT: {
      EXPLICIT: 0.9,
      IMPLICIT: 1,
    },
  },

  SCOPE_PRIORITY: {
    unknown: 0,
    single_location: 1,
    multi_file: 2,
    package: 3,
    repository: 4,
    workspace: 5,
  } as const satisfies Record<
    import("./contracts").TaskScope,
    number
  >,

  FILE_IMPACT: {
    single_location: {
      minimum: 1,
      complexMaximum: 3,
      defaultMaximum: 1,
    },
    multi_file: {
      minimum: 2,
      veryComplexMaximum: 15,
      complexMaximum: 10,
      defaultMaximum: 6,
    },
    package: {
      minimum: 3,
      veryComplexMaximum: 25,
      defaultMaximum: 15,
    },
    repository: {
      minimum: 5,
      veryComplexMaximum: 50,
      defaultMaximum: 30,
    },
    workspace: {
      minimum: 5,
    },
    unknown: {
      minimum: 1,
    },
  } as const,

  TARGET_PATTERNS: {
    FOLDER_REFERENCE: FOLDER_REFERENCE_PATTERN,
    AT_PATH_REFERENCE: AT_PATH_REFERENCE_PATTERN,
    SYMBOL_REFERENCE: SYMBOL_REFERENCE_PATTERN,
    ERROR_SYMBOL_REFERENCE: ERROR_SYMBOL_REFERENCE_PATTERN,
    LOOKS_LIKE_FILE: LOOKS_LIKE_FILE_PATTERN,
    PACKAGE_FOLDER: PACKAGE_FOLDER_PATTERN,
  },

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
  OUTCOME_PATTERNS: {
    ACTION_PATTERN: OUTCOME_ACTION_PATTERN,
    ACTION_AT_START_PATTERN,
    OUTCOME_CONNECTOR_PATTERN,
    SENTENCE_BOUNDARY_PATTERN,
    POLITE_PREFIX_PATTERN,
    LEADING_CONNECTOR_PATTERN,
    TRAILING_CONNECTOR_PATTERN,
    NEGATED_ACTION_PATTERN,
    QUESTION_PREFIX_PATTERN,
    ACKNOWLEDGEMENT_PATTERN,
  },
  INTENT_DEFAULTS: {
    VERIFICATION_REQUIRED,
    PLANNING_RECOMMENDED,
    REPOSITORY_DEPENDENT,
  },
} as const;
