import {
  corpusIndexExists,
  loadCorpusIndex,
  type CorpusIndex,
} from './corpusIndex.js';

/**
 * Host-side corpus retrieval adapter.
 *
 * V8 does not publicly export `RetrievalSource` from `@mitii/v8`, so this
 * module matches that structural contract for HybridRetrievalFactory
 * `additionalSources` (id + canRetrieve + retrieve). Provenance source id
 * is always `"corpus"`.
 */
export class CorpusRetrievalSource {
  public readonly id = 'corpus' as const;

  public constructor(
    private readonly options: {
      workspaceRoot: string;
      /** Optional preloaded index; otherwise loaded on retrieve. */
      index?: CorpusIndex;
      maximumResults?: number;
    },
  ) {}

  public canRetrieve(request: {
    query?: string;
  }): boolean {
    if (!request.query || request.query.trim().length === 0) {
      return false;
    }
    if (this.options.index) {
      return this.options.index.files.length > 0;
    }
    return corpusIndexExists(this.options.workspaceRoot);
  }

  public async retrieve(
    request: {
      query: string;
      rootIds?: readonly string[];
      maximumCandidatesPerSource?: number;
      folderPrefix?: string;
    },
    context: { abortSignal?: AbortSignal } = {},
  ): Promise<{
    status: 'complete' | 'empty' | 'cancelled' | 'unavailable';
    candidates: Array<{
      entityKind: 'chunk';
      rootId: string;
      relativePath: string;
      chunkId: string;
      title?: string;
      preview?: string;
      sourceScore: number;
      reasons: Array<{ type: 'lexical_match'; evidence: string }>;
    }>;
    truncated: boolean;
    warnings: [];
  }> {
    if (context.abortSignal?.aborted) {
      return {
        status: 'cancelled',
        candidates: [],
        truncated: false,
        warnings: [],
      };
    }

    const index =
      this.options.index ?? (await loadCorpusIndex(this.options.workspaceRoot));
    if (!index || index.files.length === 0) {
      return {
        status: 'empty',
        candidates: [],
        truncated: false,
        warnings: [],
      };
    }

    const terms = tokenize(request.query);
    if (terms.length === 0) {
      return {
        status: 'empty',
        candidates: [],
        truncated: false,
        warnings: [],
      };
    }

    const rootId = request.rootIds?.[0] ?? 'workspace';
    const limit =
      this.options.maximumResults ??
      request.maximumCandidatesPerSource ??
      12;
    const folderPrefix = request.folderPrefix?.trim();

    const scored: Array<{
      relativePath: string;
      chunkId: string;
      excerpt: string;
      score: number;
    }> = [];

    for (const file of index.files) {
      if (
        folderPrefix &&
        !file.relativePath.startsWith(folderPrefix.replace(/\\/g, '/'))
      ) {
        continue;
      }
      for (const chunk of file.chunks) {
        const haystack = `${file.relativePath}\n${chunk.excerpt}`.toLowerCase();
        let hits = 0;
        for (const term of terms) {
          if (haystack.includes(term)) hits += 1;
        }
        if (hits === 0) continue;
        scored.push({
          relativePath: file.relativePath,
          chunkId: chunk.id,
          excerpt: chunk.excerpt,
          score: hits / terms.length,
        });
      }
    }

    scored.sort(
      (left, right) =>
        right.score - left.score ||
        left.relativePath.localeCompare(right.relativePath) ||
        left.chunkId.localeCompare(right.chunkId),
    );

    const truncated = scored.length > limit;
    const candidates = scored.slice(0, limit).map((row) => ({
      entityKind: 'chunk' as const,
      rootId,
      relativePath: row.relativePath,
      chunkId: row.chunkId,
      title: row.relativePath.replace(/^.*\//, ''),
      preview: row.excerpt,
      sourceScore: row.score,
      reasons: [
        {
          type: 'lexical_match' as const,
          evidence: `corpus:${row.chunkId}`,
        },
      ],
    }));

    return {
      status: candidates.length > 0 ? 'complete' : 'empty',
      candidates,
      truncated,
      warnings: [],
    };
  }
}

function tokenize(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_./-]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2),
    ),
  ].slice(0, 32);
}
