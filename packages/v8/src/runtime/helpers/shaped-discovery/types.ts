/**
 * Intent-shaped discovery profile. Register new profiles in `registry.ts` to
 * extend deterministic glob/search + path ranking for other domains (auth,
 * database, API routing, etc.) without touching the discovery loop.
 */
export interface ShapedDiscoveryProfile {
  readonly id: string;
  /** Higher wins when multiple profiles match the same query. */
  readonly priority: number;
  matchesQuery(query: string): boolean;
  readonly globPatterns: readonly string[];
  readonly searchQueries: readonly string[];
  /**
   * Cap deterministic glob/search calls for this profile. Lists should be
   * priority-ordered. Defaults: all patterns/queries until the discovery
   * pass search budget is exhausted.
   */
  readonly maxGlobPatterns?: number;
  readonly maxSearchQueries?: number;
  scorePath(path: string): number;
  /** Minimum score for a glob/search hit to become a deterministic seed. */
  readonly minSeedScore?: number;
  readonly maxSeeds?: number;
  readonly preferredPathsLabel?: string;
  readonly discoverySystemHint?: string;
}
