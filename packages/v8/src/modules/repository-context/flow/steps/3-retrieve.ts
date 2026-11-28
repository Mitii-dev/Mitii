import type {
  RepositoryContextPipelineInput,
  RepositoryContextResolvedState,
  RepositoryContextRetrieverPort,
} from "../../contracts/types";
import type { HybridRetrievalResult } from "../../helpers/hybrid-retrieval/types";
import type { PreparedRepositoryContextRetrieval } from "../types";

export async function retrieveRepositoryContext(params: {
  input: RepositoryContextPipelineInput;
  artifacts: RepositoryContextResolvedState;
  prepared: PreparedRepositoryContextRetrieval;
  retriever: RepositoryContextRetrieverPort;
}): Promise<HybridRetrievalResult> {
  const { input, artifacts, prepared, retriever } = params;
  return retriever.retrieve({
    workspace: artifacts.descriptor.workspaceId,
    query: input.query,
    workspaceSnapshotId: artifacts.descriptor.snapshotId,
    ...(prepared.codeIndexChangeToken
      ? { codeIndexChangeToken: prepared.codeIndexChangeToken }
      : {}),
    ...(input.rootIds ? { rootIds: input.rootIds } : {}),
    ...(input.folderPrefix ? { folderPrefix: input.folderPrefix } : {}),
    ...(input.filePaths ? { filePaths: input.filePaths } : {}),
    ...(prepared.anchorFilePaths.length > 0
      ? { anchorFilePaths: prepared.anchorFilePaths }
      : {}),
    ...(prepared.rankingContext
      ? { rankingContext: prepared.rankingContext }
      : {}),
    ...(input.kinds ? { kinds: input.kinds } : {}),
    ...(input.maximumResults ? { maximumResults: input.maximumResults } : {}),
    ...(input.maximumCandidatesPerSource
      ? { maximumCandidatesPerSource: input.maximumCandidatesPerSource }
      : {}),
    ...(artifacts.repoMap ? { repoMap: artifacts.repoMap } : {}),
    ...(artifacts.repoGraph ? { repoGraph: artifacts.repoGraph } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
}
