import { HYBRID_RETRIEVAL_DEFAULTS, HYBRID_RETRIEVAL_IDS } from "./constants";

import type { WeightedReciprocalRankFusion } from "./WeightedReciprocalRankFusion";
import type {
  HybridRetrievalCandidate,
  NormalizedHybridRetrievalRequest,
  ResolvedHybridRetrieverOptions,
  SuccessfulRetrievalSourceResult,
} from "./types";

function isUnderFolderPrefix(
  relativePath: string,
  folderPrefix: string,
): boolean {
  return (
    relativePath === folderPrefix ||
    relativePath.startsWith(`${folderPrefix}/`)
  );
}

/**
 * Folder-scoped queries must keep a catalog of in-folder map files even when
 * high-scoring out-of-folder lexical hits fill the fusion window. Count
 * in-folder paths, backfill from repo-map, then keep those ahead of junk.
 */
export function backfillFolderScopedMapCandidates(
  fusion: Pick<WeightedReciprocalRankFusion, "fuse">,
  options: Pick<ResolvedHybridRetrieverOptions, "rankConstant">,
  request: NormalizedHybridRetrievalRequest,
  successful: readonly SuccessfulRetrievalSourceResult[],
  candidates: HybridRetrievalCandidate[],
): HybridRetrievalCandidate[] {
  if (!request.folderPrefix) {
    return candidates;
  }

  const folderPrefix = request.folderPrefix;
  const floor = Math.min(
    HYBRID_RETRIEVAL_DEFAULTS.MINIMUM_FOLDER_SCOPED_RESULTS,
    request.maximumResults,
  );
  const inFolder: HybridRetrievalCandidate[] = [];
  const outOfFolder: HybridRetrievalCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.relativePath)) {
      continue;
    }
    seen.add(candidate.relativePath);
    if (isUnderFolderPrefix(candidate.relativePath, folderPrefix)) {
      inFolder.push(candidate);
    } else {
      outOfFolder.push(candidate);
    }
  }
  if (inFolder.length >= floor) {
    return candidates;
  }

  const mapSource = successful.find(
    (source) => source.sourceId === HYBRID_RETRIEVAL_IDS.REPO_MAP_SOURCE,
  );
  if (!mapSource || mapSource.candidates.length === 0) {
    return candidates;
  }

  const extras = mapSource.candidates.filter(
    (candidate) =>
      !seen.has(candidate.relativePath) &&
      isUnderFolderPrefix(candidate.relativePath, folderPrefix),
  );
  if (extras.length === 0) {
    return candidates;
  }

  const fusedExtras = fusion.fuse({
    sourceResults: [
      {
        ...mapSource,
        candidates: extras,
      },
    ],
    rankConstant: options.rankConstant,
    maximumResults: Math.max(1, floor - inFolder.length),
  });

  return [...inFolder, ...fusedExtras.candidates, ...outOfFolder].slice(
    0,
    request.maximumResults,
  );
}
