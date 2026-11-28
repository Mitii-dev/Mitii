import type {
  RepositoryContextPipelineInput,
  RepositoryContextResolvedState,
} from "../../contracts/types";
import {
  collectRepositoryContextGraphAnchors,
  restrictContextReferencesToFolderPrefix,
  buildHybridRetrievalRankingContext,
} from "../../rules";
import type { PreparedRepositoryContextRetrieval } from "../types";

export type { PreparedRepositoryContextRetrieval };

export function prepareRepositoryContextRetrieval(params: {
  input: RepositoryContextPipelineInput;
  artifacts: RepositoryContextResolvedState;
}): PreparedRepositoryContextRetrieval {
  const { input, artifacts } = params;
  const focusedReferences = restrictContextReferencesToFolderPrefix(
    input.references,
    input.folderPrefix,
    input.filePaths ?? [],
  );
  return {
    codeIndexChangeToken: deriveCodeIndexChangeToken(artifacts),
    focusedReferences,
    anchorFilePaths: collectRepositoryContextGraphAnchors(focusedReferences),
    rankingContext: buildHybridRetrievalRankingContext(focusedReferences),
  };
}

function deriveCodeIndexChangeToken(
  artifacts: RepositoryContextResolvedState,
): string | undefined {
  if (artifacts.repoGraph?.codeIndexChangeToken) {
    return artifacts.repoGraph.codeIndexChangeToken;
  }
  if (artifacts.repoMap?.codeIndexChangeToken) {
    return artifacts.repoMap.codeIndexChangeToken;
  }

  const revisions = artifacts.descriptor.roots
    .map((root) => root.codeIndexRevision)
    .filter((revision): revision is string => Boolean(revision));

  return revisions.length > 0 ? revisions.join("|") : undefined;
}
