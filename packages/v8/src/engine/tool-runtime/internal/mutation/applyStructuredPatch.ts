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

  if (currentContent === undefined) {
    if (patch.oldText !== "") {
      throw new MutationError(
        "patch_conflict",
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
        "patch_conflict",
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

  const index = currentContent.indexOf(patch.oldText);
  if (index < 0) {
    throw new MutationError(
      "patch_conflict",
      `oldText not found in "${patch.path}" — re-read the file and retry with exact text.`,
    );
  }

  const second = currentContent.indexOf(patch.oldText, index + 1);
  if (second >= 0) {
    throw new MutationError(
      "patch_conflict",
      `oldText matches multiple locations in "${patch.path}" — include more context.`,
    );
  }

  const proposedContent =
    currentContent.slice(0, index) +
    patch.newText +
    currentContent.slice(index + patch.oldText.length);

  return { ok: true, proposedContent, created: false };
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
        "patch_conflict",
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
      "patch_conflict",
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
