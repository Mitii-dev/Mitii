import type { ShapedDiscoveryProfile } from "./types";
import {
  extractGlobPathsFromToolOutput,
  extractSearchPathsFromToolOutput,
} from "./toolOutput";

export function cappedGlobPatterns(
  profile: ShapedDiscoveryProfile,
): readonly string[] {
  const limit = profile.maxGlobPatterns ?? profile.globPatterns.length;
  return profile.globPatterns.slice(0, Math.max(0, limit));
}

export function cappedSearchQueries(
  profile: ShapedDiscoveryProfile,
): readonly string[] {
  const limit = profile.maxSearchQueries ?? profile.searchQueries.length;
  return profile.searchQueries.slice(0, Math.max(0, limit));
}

export async function collectShapedDiscoveryHits(params: {
  profile: ShapedDiscoveryProfile;
  shouldContinue: () => boolean;
  executeTool: (
    toolName: "glob_files" | "search_files",
    argumentsValue: Record<string, unknown>,
  ) => Promise<unknown | undefined>;
}): Promise<string[]> {
  const hits: string[] = [];
  for (const pattern of cappedGlobPatterns(params.profile)) {
    if (!params.shouldContinue()) {
      break;
    }
    const output = await params.executeTool("glob_files", {
      pattern,
      maxResults: 20,
    });
    hits.push(...extractGlobPathsFromToolOutput(output));
  }
  for (const searchQuery of cappedSearchQueries(params.profile)) {
    if (!params.shouldContinue()) {
      break;
    }
    const output = await params.executeTool("search_files", {
      query: searchQuery,
      maxMatches: 12,
    });
    hits.push(...extractSearchPathsFromToolOutput(output));
  }
  return hits;
}
