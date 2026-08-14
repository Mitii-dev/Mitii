/**
 * Message patterns for Decision Policy routing heuristics.
 * Keep catalogs here; keep orchestration in actions.
 *
 * Catalogs stay language-/layout-aware defaults, not JS-only special cases.
 * Prefer stack/compiler/exit signals and path anchors over English idioms alone.
 */

/**
 * Common first-segment workspace roots across languages and layouts.
 * Single-segment @mentions (@packages, @crates, @cmd) use this catalog;
 * multi-segment @paths match generically regardless of first segment.
 */
export const WORKSPACE_PATH_ROOT_SEGMENTS = [
  "package",
  "packages",
  "app",
  "apps",
  "lib",
  "libs",
  "service",
  "services",
  "module",
  "modules",
  "src",
  "crate",
  "crates",
  "cmd",
  "internal",
  "pkg",
  "bin",
  "example",
  "examples",
  "testdata",
  "vendor",
  "third_party",
  "third-party",
  "proto",
  "api",
  "backend",
  "frontend",
  "server",
  "client",
  "web",
  "mobile",
  "desktop",
  "tool",
  "tools",
  "script",
  "scripts",
  "config",
  "configs",
  "deploy",
  "infra",
  "chart",
  "charts",
  "helm",
  "doc",
  "docs",
  "test",
  "tests",
  "spec",
  "specs",
] as const;

const WORKSPACE_PATH_ROOT_ALTERNATION = WORKSPACE_PATH_ROOT_SEGMENTS.join("|");

/** Explicit failure / breakage phrasing (natural language + compiler/runtime). */
export const WORKSPACE_BUG_FAILURE_LANGUAGE =
  /\b(?:issue|bug|error|fail(?:s|ed|ing)?|unable|not\s+working|doesn'?t\s+work|broken|crash(?:es|ed|ing)?|blank|preview\s+(?:is\s+)?(?:not|never)|(?:no|never)\s+preview|doesn'?t\s+load|load(?:ing)?\s+(?:issue|error|fail|broken)|render(?:ing)?\s+(?:issue|error|fail|broken)|has already been declared|is not defined|cannot read propert(?:y|ies)|cannot find (?:name|module)|still\s+(?:broken|failing)|traceback|stack\s*trace|exit\s+code|non-?zero|compilation\s+failed|build\s+failed|test(?:s)?\s+fail|undefined\s+reference|unresolved\s+import|does\s+not\s+compile|panic!)\b/i;

/**
 * Well-known runtime / language error tokens across common ecosystems.
 * PascalCase *Error/*Exception also covered by WORKSPACE_BUG_NAMED_ERROR.
 */
export const WORKSPACE_BUG_RUNTIME_ERROR =
  /\b(?:SyntaxError|TypeError|ReferenceError|RangeError|EvalError|URIError|AggregateError|NameError|AttributeError|ImportError|ModuleNotFoundError|KeyError|ValueError|RuntimeError|IndentationError|NullPointerException|ClassNotFoundException|IllegalArgumentException|panic:|fatal error:|SIGSEGV|segfault|error\[E\d+\])\b/i;

/** Generic PascalCase Error/Exception names from stacks. */
export const WORKSPACE_BUG_NAMED_ERROR =
  /\b[A-Z][A-Za-z0-9]*(?:Error|Exception)\b/;

/**
 * Exact "not working" / "doesn't work" family (no typo tolerance).
 * Typo-near "not" before "working" is handled in the detector.
 */
export const WORKSPACE_BUG_NOT_WORKING_EXACT =
  /\b(?:not|never|isn'?t|ain'?t|doesn'?t|dont|won't|cant|can't)\s+working\b|\bdoesn'?t\s+work\b/i;

/** Token immediately before "working" — used for near-"not" typo checks. */
export const WORKSPACE_BUG_WORD_BEFORE_WORKING =
  /\b([A-Za-z']+)\s+working\b/gi;

/**
 * Workspace / product anchors that turn a failure report into a
 * repository-grounded bug report rather than a generic complaint.
 */
export const WORKSPACE_BUG_ANCHOR =
  /\b(?:ui|preview|component|import(?:ed|s)?|package|library|module|build|load(?:ing)?|render(?:ing)?|page|screen|app|workspace|repo|repository|codebase|docs?|mdx|editor|crate|binary|service|endpoint|compiler|linker)\b/i;

export const WORKSPACE_BUG_PACKAGE_FROM =
  /\bfrom\s+[`'"]?[@\w.-]+(?:\/[\w.-]+)?[`'"]?\b/i;

/** @apps/docs style paths, or single-segment roots from the shared catalog. */
export const WORKSPACE_BUG_AT_WORKSPACE_REF = new RegExp(
  `(?:^|[\\s"'\\\`])@(?:[A-Za-z_][\\w.-]*(?:\\/[\\w.-]+)+|(?:${WORKSPACE_PATH_ROOT_ALTERNATION}))\\b`,
  "i",
);

/**
 * Relative repo paths: either a known-root prefix, or any multi-segment path
 * that ends in a file extension (layout-neutral).
 */
export const WORKSPACE_BUG_REPO_PATH = new RegExp(
  `\\b(?:${WORKSPACE_PATH_ROOT_ALTERNATION})\\/[a-zA-Z0-9_./-]+|\\b(?:[A-Za-z_][\\w.-]*\\/){1,8}[A-Za-z0-9_.-]+\\.[A-Za-z0-9]+\\b`,
  "i",
);

export const WORKSPACE_BUG_LOCALHOST =
  /\bhttps?:\/\/localhost(?::\d+)?\//i;

/**
 * Broad repair phrasing that should get a visible plan (not language-specific).
 * Matches "fix/resolve all errors", "across the package/module", etc.
 */
export const BROAD_REPAIR_REQUEST =
  /\b(?:fix|resolve|clear|eliminate)\s+all\b|\ball\s+(?:errors?|failures?|diagnostics?|warnings?)\b|\bacross\s+(?:the\s+)?(?:package|module|workspace|repository|codebase)\b|\bpackage[- ]wide\b|\bmulti[- ]file\s+(?:fix|repair|cleanup)\b/i;

/** Grouped pattern catalog for decision actions. */
export const DECISION_POLICY_PATTERNS = {
  broadRepairRequest: BROAD_REPAIR_REQUEST,
} as const;

/** Max Levenshtein distance when treating a token as a mistyped "not". */
export const WORKSPACE_BUG_NOT_TYPO_MAX_DISTANCE = 1;

/** Allowed token length window around "not" for typo candidates. */
export const WORKSPACE_BUG_NOT_TYPO_MIN_LENGTH = 2;
export const WORKSPACE_BUG_NOT_TYPO_MAX_LENGTH = 4;
