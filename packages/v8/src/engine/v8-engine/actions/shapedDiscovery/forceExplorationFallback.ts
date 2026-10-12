import {
  extractGlobPathsFromToolOutput,
  extractSearchPathsFromToolOutput,
} from "./toolOutput";

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "how",
  "can",
  "i",
  "you",
  "we",
  "please",
  "plan",
  "planning",
  "change",
  "changing",
  "architecture",
  "improve",
  "improving",
  "help",
  "want",
  "need",
  "should",
  "could",
  "would",
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "when",
  "where",
  "why",
]);

/**
 * Derive a few search queries from the user ask when no shaped profile matches.
 * Keeps discovery generic (no custom repo paths).
 */
export function buildForceExplorationSearchQueries(query: string): string[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }
  const tokens = normalized
    .replace(/[^a-z0-9\s/_-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !STOPWORDS.has(token) &&
        !/^\d+$/.test(token),
    );
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
    if (unique.length >= 4) break;
  }
  if (unique.length === 0) {
    return [];
  }
  const paired =
    unique.length >= 2 ? [`${unique[0]} ${unique[1]}`] : [unique[0]!];
  return [...paired, ...unique.slice(0, 2)].slice(0, 3);
}

/**
 * Query-derived search/glob when Plan thorough force-exploration has no
 * shaped profile — prevents seed-read-only discovery.
 */
export async function collectForceExplorationFallbackHits(params: {
  query: string;
  shouldContinue: () => boolean;
  executeTool: (
    toolName: "glob_files" | "search_files",
    argumentsValue: Record<string, unknown>,
  ) => Promise<unknown | undefined>;
}): Promise<string[]> {
  const hits: string[] = [];
  const searches = buildForceExplorationSearchQueries(params.query);
  for (const searchQuery of searches) {
    if (!params.shouldContinue()) {
      break;
    }
    const output = await params.executeTool("search_files", {
      query: searchQuery,
      maxMatches: 12,
    });
    hits.push(...extractSearchPathsFromToolOutput(output));
  }
  // One broad source glob if searches produced nothing useful.
  if (hits.length === 0 && params.shouldContinue()) {
    const output = await params.executeTool("glob_files", {
      pattern: "**/*.{ts,tsx,js,jsx,mjs,cjs,md}",
      maxResults: 20,
    });
    hits.push(...extractGlobPathsFromToolOutput(output));
  }
  return hits;
}
