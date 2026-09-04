import { hashContent } from "./checkpoint";
import { MutationError } from "./types";
import type { StructuredPatch } from "./types";

export interface PatchPreflightSuccess {
  ok: true;
  proposedContent: string;
  created: boolean;
}

/**
 * Validate a structured oldText/newText patch against current file content.
 * Does not write. Fuzzy matching is intentionally omitted — exact match only
 * so conflict recovery is deterministic.
 */
export function preflightStructuredPatch(params: {
  patch: StructuredPatch;
  currentContent: string | undefined;
}): PatchPreflightSuccess {
  const { patch, currentContent } = params;

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
    throw new MutationError(
      "identical_old_and_new",
      `oldText and newText are identical for "${patch.path}" — this patch would not change the file. Retry apply_patch with a different newText that actually edits the file. Copy exact oldText from currentContent; do not resend the same block.`,
    );
  }

  const replaced = replaceExactOccurrences(
    currentContent,
    patch.oldText,
    patch.newText,
  );
  if (replaced.count === 0) {
    throw new MutationError(
      "old_text_not_found",
      `oldText not found in "${patch.path}" — copy exact text from currentContent and retry.`,
    );
  }

  if (patch.replaceAll !== true && replaced.count > 1) {
    throw new MutationError(
      "old_text_ambiguous",
      `oldText matches multiple locations in "${patch.path}" — include more surrounding context, or set replaceAll=true to replace every exact occurrence.`,
    );
  }

  return { ok: true, proposedContent: replaced.content, created: false };
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
