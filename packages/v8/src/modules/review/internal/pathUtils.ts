import { extname } from "node:path";

import type { ReviewExcludeReason } from "../contracts";
import { REVIEW_POLICY } from "../policy";

export function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function extensionOf(path: string): string {
  const ext = extname(normalizeRelativePath(path)).toLowerCase();
  return ext;
}

export function matchGlob(path: string, pattern: string): boolean {
  const normalized = normalizeRelativePath(path);
  const patterns = expandBraces(pattern.replace(/\\/g, "/"));
  return patterns.some((p) => matchSingleGlob(normalized, p));
}

function expandBraces(pattern: string): string[] {
  const match = pattern.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!match) return [pattern];
  const [, prefix, body, suffix] = match;
  const alternatives = body!.split(",");
  return alternatives.flatMap((alt) =>
    expandBraces(`${prefix}${alt}${suffix}`),
  );
}

function matchSingleGlob(normalized: string, pattern: string): boolean {
  let p = pattern;
  // Allow **/*.ts to match src/app.ts
  if (p.startsWith("**/")) {
    const rest = p.slice(3);
    if (matchSingleGlob(normalized, rest)) return true;
    // Also try matching against any suffix path segment
    const parts = normalized.split("/");
    for (let i = 0; i < parts.length; i += 1) {
      if (matchSingleGlob(parts.slice(i).join("/"), rest)) return true;
    }
  }
  const escaped = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`).test(normalized);
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.includes("*") || pattern.includes("?")) {
      return matchGlob(path, pattern);
    }
    const normalized = normalizeRelativePath(path);
    const needle = pattern.replace(/\\/g, "/");
    return (
      normalized === needle ||
      normalized.startsWith(needle.endsWith("/") ? needle : `${needle}/`) ||
      normalized.includes(needle)
    );
  });
}

export function isDefaultExcludedPath(path: string): boolean {
  const normalized = normalizeRelativePath(path);
  for (const pattern of REVIEW_POLICY.defaultExcludePathPatterns) {
    if (pattern.includes("*")) {
      if (matchGlob(normalized, pattern) || matchGlob(normalized, `**/${pattern}`)) {
        return true;
      }
      continue;
    }
    if (normalized === pattern || normalized.includes(pattern)) {
      return true;
    }
  }
  return false;
}

export function isAllowedExtension(path: string): boolean {
  const ext = extensionOf(path);
  if (!ext) {
    // Extensionless files (Dockerfile, Makefile) — allow if not default-excluded
    return true;
  }
  return REVIEW_POLICY.allowedExtensions.has(ext);
}

export function estimateDiffTokens(diff: string): number {
  // Cheap char/4 estimator; hosts may inject better counters later.
  if (!diff) return 0;
  return Math.ceil(diff.length / 4);
}

export function excludeReasonLabel(reason: ReviewExcludeReason): string {
  switch (reason) {
    case "none":
      return "selected";
    case "binary":
      return "binary";
    case "user_exclude":
      return "user_exclude";
    case "unsupported_ext":
      return "unsupported_ext";
    case "default_path":
      return "default_path";
    case "deleted":
      return "deleted";
    case "too_large":
      return "too_large";
    default:
      return reason;
  }
}

export function fingerprintGroup(paths: readonly string[]): string {
  return [...paths].map(normalizeRelativePath).sort().join("|");
}

export function findingFingerprint(params: {
  path: string;
  startLine?: number;
  content: string;
  existingCode: string;
}): string {
  const base = [
    normalizeRelativePath(params.path),
    String(params.startLine ?? 0),
    params.content.trim().slice(0, 120),
    params.existingCode.trim().slice(0, 80),
  ].join("::");
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  }
  return `f${hash.toString(16)}`;
}
