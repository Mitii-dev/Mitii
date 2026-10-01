import type { SizeDraft } from "./UnderstandingEvidencePack";

const WORD_MEDIUM_THRESHOLD = 300;

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

export function computeSizeDraft(params: {
  text: string;
  pinnedFolder: boolean;
  pinnedFileCount: number;
  approxWords?: number;
}): SizeDraft {
  const reasons: string[] = [];
  let rank = 0; // 0 small, 1 medium, 2 large

  const approxWords = params.approxWords ?? countApproxWords(params.text);
  const dump = looksLikePasteDump(params.text);
  const testDump = looksLikeTestFailurePaste(params.text);
  const failPaths = countDistinctFailPaths(params.text);

  if (params.pinnedFolder) {
    rank = Math.max(rank, 1);
    reasons.push("pinned_folder");
  }

  if (approxWords >= WORD_MEDIUM_THRESHOLD) {
    rank = Math.max(rank, 1);
    reasons.push(`words>=${WORD_MEDIUM_THRESHOLD}`);
  }

  if (dump || testDump) {
    rank = Math.max(rank, 1);
    reasons.push(testDump ? "test_failure_paste" : "paste_dump");
  }

  if (failPaths >= 2) {
    rank = Math.max(rank, 1);
    reasons.push(`fail_paths=${failPaths}`);
  }

  if (failPaths >= 5 || approxWords >= 800) {
    rank = Math.max(rank, 2);
    reasons.push(failPaths >= 5 ? "many_fail_paths" : "words>=800");
  }

  if (
    rank === 0 &&
    params.pinnedFileCount <= 1 &&
    approxWords < WORD_MEDIUM_THRESHOLD &&
    !dump
  ) {
    reasons.push("single_short_ask");
  }

  const taskSize = rank >= 2 ? "large" : rank === 1 ? "medium" : "small";
  return { taskSize, reasons };
}

export function defaultPlanningHintForSize(
  taskSize: SizeDraft["taskSize"],
): "none" | "short" | "medium" | "long" {
  switch (taskSize) {
    case "small":
      return "none";
    case "medium":
      return "short";
    case "large":
      return "long";
  }
}
