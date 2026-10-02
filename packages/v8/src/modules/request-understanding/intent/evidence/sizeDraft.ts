import type { SizeDraft } from "./UnderstandingEvidencePack";

/** Approx tokens: chars/4 (code-agent prompts; not a true tokenizer). */
export const TOKEN_MEDIUM_CANDIDATE = 500;
/** Large is a candidate only — paste/fail-path signals promote independently. */
export const TOKEN_LARGE_CANDIDATE = 2000;
/** Soft narrative cap; tokens above this still count as large candidate. */
export const TOKEN_LARGE_CANDIDATE_CAP = 2500;

const PASTE_DUMP_PATTERN =
  /(?:TypeError|ReferenceError|SyntaxError|RangeError|AssertionError|Error:|at\s+\S+\s+\([^)]+:\d+:\d+\)|Traceback \(most recent call last\)|panic:|FAIL\s+\S+)/i;

const TEST_FAILURE_PASTE_PATTERN =
  /(?:Failed Tests?\s+\d+|FAIL\s+\S+\.(?:test|spec)\.[jt]sx?\b|AssertionError|expected .+ to (?:be|equal|deeply equal)|⎯+.*Failed Tests)/i;

const FAIL_PATH_PATTERN =
  /\bFAIL\s+([^\s>]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java))\b/gi;

export function countApproxWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/** Rough token estimate for size banding (chars / 4). */
export function countApproxTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.ceil(trimmed.length / 4);
}

export function looksLikePasteDump(text: string): boolean {
  return PASTE_DUMP_PATTERN.test(text);
}

export function looksLikeTestFailurePaste(text: string): boolean {
  return TEST_FAILURE_PASTE_PATTERN.test(text);
}

export function countDistinctFailPaths(text: string): number {
  const paths = new Set<string>();
  for (const match of text.matchAll(FAIL_PATH_PATTERN)) {
    const path = match[1]?.trim();
    if (path) {
      paths.add(path.toLowerCase());
    }
  }
  return paths.size;
}

/**
 * Advisory size draft. Token length is one candidate signal only —
 * Officer override wins; pinned folder does NOT bump size (it is a work root).
 */
export function computeSizeDraft(params: {
  text: string;
  pinnedFolder: boolean;
  pinnedFileCount: number;
  approxWords?: number;
  approxTokens?: number;
}): SizeDraft {
  const reasons: string[] = [];
  let rank = 0; // 0 small, 1 medium, 2 large

  const approxWords = params.approxWords ?? countApproxWords(params.text);
  const approxTokens = params.approxTokens ?? countApproxTokens(params.text);
  const dump = looksLikePasteDump(params.text);
  const testDump = looksLikeTestFailurePaste(params.text);
  const failPaths = countDistinctFailPaths(params.text);

  // Pinned folder is a path-scope root, not a size escalator.
  if (params.pinnedFolder) {
    reasons.push("pinned_folder_scope_only");
  }

  if (approxTokens >= TOKEN_MEDIUM_CANDIDATE) {
    rank = Math.max(rank, 1);
    reasons.push(`tokens>=${TOKEN_MEDIUM_CANDIDATE}`);
  }

  if (approxTokens >= TOKEN_LARGE_CANDIDATE) {
    rank = Math.max(rank, 2);
    reasons.push(`tokens>=${TOKEN_LARGE_CANDIDATE}`);
  }

  if (dump || testDump) {
    rank = Math.max(rank, 1);
    reasons.push(testDump ? "test_failure_paste" : "paste_dump");
  }

  if (failPaths >= 2) {
    rank = Math.max(rank, 1);
    reasons.push(`fail_paths=${failPaths}`);
  }

  if (failPaths >= 5) {
    rank = Math.max(rank, 2);
    reasons.push("many_fail_paths");
  }

  if (
    rank === 0 &&
    params.pinnedFileCount <= 1 &&
    approxTokens < TOKEN_MEDIUM_CANDIDATE &&
    !dump
  ) {
    reasons.push("single_short_ask");
  }

  // Keep words in reasons for diagnostics when useful (not a size latch).
  if (approxWords > 0 && reasons.every((r) => !r.startsWith("tokens>="))) {
    reasons.push(`words=${approxWords}`);
  }

  void TOKEN_LARGE_CANDIDATE_CAP;

  const taskSize = rank >= 2 ? "large" : rank === 1 ? "medium" : "small";
  return { taskSize, reasons };
}

export function defaultPlanningHintForSize(
  taskSize: SizeDraft["taskSize"],
): "none" | "short" | "medium" | "long" {
  switch (taskSize) {
    case "small":
      return "short";
    case "medium":
      return "short";
    case "large":
      return "long";
  }
}
