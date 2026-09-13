import { hashContent } from "./checkpoint";
import {
  buildEditFormatRepairHints,
  formatEditFormatRepairHints,
} from "./editFormatRepairHints";
import { MutationError } from "./types";
import type { ToolReasonCode } from "../../contracts";
import type { StructuredPatch } from "./types";

function patchFailure(
  code: ToolReasonCode,
  summary: string,
  path: string,
  fuzzyMatchEnabled?: boolean,
): never {
  const ladder = formatEditFormatRepairHints(
    buildEditFormatRepairHints({
      code,
      path,
      fuzzyMatchEnabled,
    }),
  );
  throw new MutationError(
    code,
    ladder ? `${summary}\n${ladder}` : summary,
  );
}

export interface PatchPreflightSuccess {
  ok: true;
  proposedContent: string;
  created: boolean;
  /** True when a non-exact (bounded fuzzy) match was used. */
  fuzzyApplied?: boolean;
}

/**
 * Validate a structured oldText/newText patch against current file content.
 * Does not write. Exact match is primary; optional bounded fuzzy recovery
 * (trim / indent-normalize / unique ±5 line window) when fuzzyMatch is on.
 */
export function preflightStructuredPatch(params: {
  patch: StructuredPatch;
  currentContent: string | undefined;
  /** Host / tool default when patch.fuzzyMatch is unset. */
  fuzzyMatch?: boolean;
}): PatchPreflightSuccess {
  const { patch, currentContent } = params;
  const fuzzyMatch = patch.fuzzyMatch === true || params.fuzzyMatch === true;

  if (patch.replaceAll === true && patch.oldText === "") {
    throw new MutationError(
      "invalid_arguments",
      `replaceAll cannot be used with empty oldText for "${patch.path}" — empty oldText creates or replaces the whole file.`,
    );
  }

  if (currentContent === undefined) {
    if (patch.oldText !== "") {
      throw new MutationError(
        "patch_target_missing",
        `File not found for patch path "${patch.path}" and oldText is non-empty.`,
      );
    }
    return {
      ok: true,
      proposedContent: patch.newText,
      created: true,
    };
  }

  if (patch.expectedHash) {
    const actual = hashContent(currentContent);
    if (actual !== patch.expectedHash) {
      throw new MutationError(
        "patch_hash_mismatch",
        `File hash mismatch for "${patch.path}" — file may have changed.`,
      );
    }
  }

  if (patch.oldText === "") {
    // Full-file replace of an existing file.
    return {
      ok: true,
      proposedContent: patch.newText,
      created: false,
    };
  }

  if (patch.oldText === patch.newText) {
    patchFailure(
      "identical_old_and_new",
      `oldText and newText are identical for "${patch.path}" — this patch would not change the file. Retry apply_patch with a different newText that actually edits the file. Copy exact oldText from currentContent; do not resend the same block.`,
      patch.path,
      fuzzyMatch,
    );
  }

  const exact = replaceExactOccurrences(
    currentContent,
    patch.oldText,
    patch.newText,
  );
  if (exact.count > 0) {
    if (patch.replaceAll !== true && exact.count > 1) {
      patchFailure(
        "old_text_ambiguous",
        `oldText matches multiple locations in "${patch.path}" — include more surrounding context, or set replaceAll=true to replace every exact occurrence.`,
        patch.path,
        fuzzyMatch,
      );
    }
    return { ok: true, proposedContent: exact.content, created: false };
  }

  if (!fuzzyMatch) {
    patchFailure(
      "old_text_not_found",
      `oldText not found in "${patch.path}" — copy exact text from currentContent and retry.`,
      patch.path,
      false,
    );
  }

  const fuzzy = tryFuzzyReplace({
    content: currentContent,
    oldText: patch.oldText,
    newText: patch.newText,
    replaceAll: patch.replaceAll === true,
    path: patch.path,
  });
  return {
    ok: true,
    proposedContent: fuzzy.content,
    created: false,
    fuzzyApplied: true,
  };
}

/**
 * Non-overlapping left-to-right exact replacements. `oldText` is never
 * treated as a regular expression.
 */
function replaceExactOccurrences(
  content: string,
  oldText: string,
  newText: string,
): { content: string; count: number } {
  let count = 0;
  let searchFrom = 0;
  let next = "";
  while (true) {
    const index = content.indexOf(oldText, searchFrom);
    if (index < 0) {
      next += content.slice(searchFrom);
      return { content: next, count };
    }
    next += content.slice(searchFrom, index) + newText;
    searchFrom = index + oldText.length;
    count += 1;
  }
}

function tryFuzzyReplace(params: {
  content: string;
  oldText: string;
  newText: string;
  replaceAll: boolean;
  path: string;
}): { content: string } {
  // 1) Trimmed exact match
  const trimmedOld = params.oldText.trim();
  if (trimmedOld.length > 0 && trimmedOld !== params.oldText) {
    const trimmed = replaceExactOccurrences(
      params.content,
      trimmedOld,
      params.newText.trim(),
    );
    if (trimmed.count === 1 || (params.replaceAll && trimmed.count > 0)) {
      if (!params.replaceAll && trimmed.count > 1) {
        throw new MutationError(
          "patch_fuzzy_ambiguous",
          `Fuzzy trim match is ambiguous in "${params.path}" (${trimmed.count} hits).`,
        );
      }
      return { content: trimmed.content };
    }
    if (trimmed.count > 1) {
      throw new MutationError(
        "patch_fuzzy_ambiguous",
        `Fuzzy trim match is ambiguous in "${params.path}" (${trimmed.count} hits).`,
      );
    }
  }

  // 2) Indent-normalized unique match
  const indentHit = findUniqueIndentNormalizedMatch(
    params.content,
    params.oldText,
  );
  if (indentHit === "ambiguous") {
    throw new MutationError(
      "patch_fuzzy_ambiguous",
      `Fuzzy indent-normalized match is ambiguous in "${params.path}".`,
    );
  }
  if (indentHit) {
    return {
      content:
        params.content.slice(0, indentHit.start) +
        adaptNewTextIndent(params.newText, indentHit.indent) +
        params.content.slice(indentHit.end),
    };
  }

  // 3) Unique ±5 line window around a normalized needle
  const windowHit = findUniqueLineWindowMatch(params.content, params.oldText);
  if (windowHit === "ambiguous") {
    throw new MutationError(
      "patch_fuzzy_ambiguous",
      `Fuzzy ±5 line window match is ambiguous in "${params.path}".`,
    );
  }
  if (windowHit) {
    return {
      content:
        params.content.slice(0, windowHit.start) +
        params.newText +
        params.content.slice(windowHit.end),
    };
  }

  throw new MutationError(
    "old_text_not_found",
    `oldText not found in "${params.path}" (exact and bounded fuzzy recovery failed) — copy exact text from currentContent and retry.`,
  );
}

function normalizeIndentLines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s+/, "").replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

function findUniqueIndentNormalizedMatch(
  content: string,
  oldText: string,
): { start: number; end: number; indent: string } | "ambiguous" | undefined {
  const needle = normalizeIndentLines(oldText);
  if (!needle) return undefined;

  const contentLines = content.replace(/\r\n/g, "\n").split("\n");
  const needleLines = needle.split("\n");
  const hits: Array<{ startLine: number; endLine: number }> = [];

  for (let i = 0; i <= contentLines.length - needleLines.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needleLines.length; j += 1) {
      if (normalizeIndentLines(contentLines[i + j] ?? "") !== needleLines[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      hits.push({ startLine: i, endLine: i + needleLines.length });
    }
  }

  if (hits.length === 0) return undefined;
  if (hits.length > 1) return "ambiguous";

  const hit = hits[0]!;
  const start = lineOffset(contentLines, hit.startLine);
  const end = lineOffset(contentLines, hit.endLine);
  const firstLine = contentLines[hit.startLine] ?? "";
  const indent = firstLine.match(/^\s*/)?.[0] ?? "";
  return { start, end: Math.min(end, content.length), indent };
}

function adaptNewTextIndent(newText: string, indent: string): string {
  const normalized = newText.replace(/\r\n/g, "\n");
  if (!indent) return normalized;
  return normalized
    .split("\n")
    .map((line, index) => {
      if (line.length === 0) return line;
      if (index === 0) return indent + line.replace(/^\s+/, "");
      return indent + line.replace(/^\s+/, "");
    })
    .join("\n");
}

function findUniqueLineWindowMatch(
  content: string,
  oldText: string,
): { start: number; end: number } | "ambiguous" | undefined {
  const needle = normalizeIndentLines(oldText);
  if (!needle) return undefined;
  const needleFirst = needle.split("\n")[0] ?? "";
  if (!needleFirst) return undefined;

  const contentLines = content.replace(/\r\n/g, "\n").split("\n");
  const hits: Array<{ start: number; end: number }> = [];
  const oldLineCount = Math.max(1, oldText.replace(/\r\n/g, "\n").split("\n").length);

  for (let i = 0; i < contentLines.length; i += 1) {
    if (normalizeIndentLines(contentLines[i] ?? "") !== needleFirst) {
      continue;
    }
    const windowStart = Math.max(0, i - 5);
    const windowEnd = Math.min(contentLines.length, i + oldLineCount + 5);
    const windowText = contentLines.slice(windowStart, windowEnd).join("\n");
    if (!normalizeIndentLines(windowText).includes(needle)) {
      continue;
    }
    // Prefer the contiguous block starting at the first-line hit.
    const blockEndLine = Math.min(contentLines.length, i + oldLineCount);
    const start = lineOffset(contentLines, i);
    const end = lineOffset(contentLines, blockEndLine);
    hits.push({ start, end: Math.min(end, content.length) });
  }

  if (hits.length === 0) return undefined;
  if (hits.length > 1) return "ambiguous";
  return hits[0];
}

function lineOffset(lines: readonly string[], lineIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex && i < lines.length; i += 1) {
    offset += (lines[i]?.length ?? 0) + 1; // +1 for '\n'
  }
  return offset;
}

/**
 * Lightweight post-edit parse gates for common formats.
 * Never claims semantic correctness — only blocks obvious broken writes.
 */
export function validatePostEditSyntax(
  relativePath: string,
  content: string,
): void {
  if (/\.json$/i.test(relativePath)) {
    try {
      JSON.parse(content);
    } catch (error) {
      throw new MutationError(
        "patch_syntax_invalid",
        `Invalid JSON after patch for "${relativePath}": ${String(error)}`,
      );
    }
  }

  if (!/\.(?:tsx?|jsx?|mjs|cjs)$/i.test(relativePath)) {
    return;
  }

  const braces = countChar(content, "{") - countChar(content, "}");
  const parens = countChar(content, "(") - countChar(content, ")");
  if (braces !== 0 || parens !== 0) {
    throw new MutationError(
      "patch_syntax_invalid",
      `Bracket imbalance after patch for "${relativePath}".`,
    );
  }
}

function countChar(content: string, char: string): number {
  let count = 0;
  for (const c of content) {
    if (c === char) {
      count += 1;
    }
  }
  return count;
}
