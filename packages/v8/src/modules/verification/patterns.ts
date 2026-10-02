/**
 * Language-agnostic path and residual patterns for Verification.
 *
 * Denied segments align with repository-state ignore directories (vendor trees,
 * language package caches, build outputs) — not one ecosystem's layout.
 */

/** Directory segments that never carry ask-scoped source defects. */
export const VERIFICATION_DENIED_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  "site-packages",
  ".gradle",
  ".mvn",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".cargo",
  "Pods",
  "Carthage",
]);

/**
 * Synthetic / non-workspace paths produced when a runner fails without a
 * parseable source location. Treat as harness residual unless paired with a
 * real assertion body under ask scope (handled by AssessTaskRelevantEvidence).
 */
export const VERIFICATION_SYNTHETIC_DIAGNOSTIC_PATHS: ReadonlySet<string> =
  new Set(["<test>", "<unknown>", "<stdin>"]);

/**
 * Secondary-gate phantoms that contradict a passed project compile/typecheck.
 * Kept as message/code patterns — not a single language's full diagnostic set.
 */
export const PHANTOM_SECONDARY_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  "TS17004", // JSX flag missing while package tsc with jsx already passed
  "TS7006", // implicit any from mis-scoped language service / syntax port
]);

const PHANTOM_SECONDARY_MESSAGE =
  /cannot use jsx unless[\s\S]*--jsx|jsx flag is not set|implicitly has an ['`]any['`] type/i;

/** Runner / stack-frame prefixes before a real path (vitest, pytest, gdb, …). */
const HARNESS_FRAME_PREFIX =
  /^(?:[❯>✦*+\-•]\s+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s+)/;

export function normalizeVerificationPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

/**
 * True when the diagnostic path points into a denied vendor/cache/VCS tree,
 * including harness-prefixed lines that embed such a path.
 */
export function isDeniedDiagnosticPath(path: string): boolean {
  const normalized = normalizeVerificationPath(path);
  if (!normalized) {
    return true;
  }
  if (VERIFICATION_SYNTHETIC_DIAGNOSTIC_PATHS.has(normalized.toLowerCase())) {
    return false; // synthetic handled separately
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => VERIFICATION_DENIED_PATH_SEGMENTS.has(segment))) {
    return true;
  }

  // "❯ EventEmitter.onMessage ../../node_modules/vitest/…"
  for (const denied of VERIFICATION_DENIED_PATH_SEGMENTS) {
    const escaped = denied.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const embedded = new RegExp(
      `(?:^|[/\\s])${escaped}(?:/|$)`,
      "i",
    );
    if (embedded.test(normalized)) {
      return true;
    }
  }
  return false;
}

/**
 * True for stack-frame shaped paths (runner frames, not source diagnostics).
 * Generic: symbol.chain + path:line, or denied-tree embed with tiny numeric message.
 */
export function isHarnessFrameDiagnostic(params: {
  path: string;
  message?: string;
}): boolean {
  const normalized = normalizeVerificationPath(params.path);
  if (!normalized) {
    return true;
  }
  if (isDeniedDiagnosticPath(normalized)) {
    return true;
  }
  if (HARNESS_FRAME_PREFIX.test(normalized) && /[/\\]/.test(normalized)) {
    return true;
  }
  // path:line captured as message-only column leftover ("20")
  const message = (params.message ?? "").trim();
  if (/^\d{1,4}$/.test(message) && /[/\\]/.test(normalized)) {
    return true;
  }
  return false;
}

export function isSyntheticDiagnosticPath(path: string): boolean {
  return VERIFICATION_SYNTHETIC_DIAGNOSTIC_PATHS.has(
    normalizeVerificationPath(path).toLowerCase(),
  );
}

/**
 * Config / secondary-parser phantoms that are not authoritative when a
 * project-local typecheck or build already passed.
 */
export function isPhantomSecondaryDiagnostic(params: {
  code?: string;
  message?: string;
}): boolean {
  const code = (params.code ?? "").toUpperCase();
  if (code && PHANTOM_SECONDARY_DIAGNOSTIC_CODES.has(code)) {
    return true;
  }
  return PHANTOM_SECONDARY_MESSAGE.test(params.message ?? "");
}

export function isWorkspaceRootCheckId(params: {
  checkId: string;
  projectId?: string;
}): boolean {
  const projectId = (params.projectId ?? "").trim().toLowerCase();
  if (
    projectId === "workspace-root" ||
    projectId === "root" ||
    projectId === "."
  ) {
    return true;
  }
  const checkId = params.checkId.toLowerCase();
  return (
    checkId.startsWith("workspace-root:") || checkId.startsWith("root:")
  );
}
