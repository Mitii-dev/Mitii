import type {
  ChangeImpactParsedInput,
  ChangeImpactReasonCode,
  ChangeImpactWarningCode,
} from "../../contracts";
import {
  createFileIndex,
  createNodeIndex,
  createProjectIndex,
  normalizeRelativePath,
} from "../../helpers/impactGraphHelpers";
import type { ResolvedSeedNode } from "../../helpers/impactTypes";
import { resolveSeedNodes } from "../../helpers/resolveSeedNodes";
import type { RepoGraph } from "../../../repository-state";

export type ResolveSeedsResult = {
  resolvedSeeds: ResolvedSeedNode[];
  nodeById: ReturnType<typeof createNodeIndex>;
  fileByFileId: ReturnType<typeof createFileIndex>;
  projectByProjectId: ReturnType<typeof createProjectIndex>;
  seedRelativePath: string | undefined;
};

/**
 * Flow step 2: index the graph and resolve file/symbol/caret seeds.
 */
export function resolveChangeImpactSeeds(params: {
  input: ChangeImpactParsedInput;
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
  reasonCodes: Set<ChangeImpactReasonCode>;
}): ResolveSeedsResult {
  const graph: RepoGraph = params.input.repoGraph;
  const nodeById = createNodeIndex(graph);
  const fileByFileId = createFileIndex(graph);
  const projectByProjectId = createProjectIndex(graph);

  const resolvedSeeds = resolveSeedNodes({
    input: params.input,
    nodeById,
    fileByFileId,
    projectByProjectId,
    warnings: params.warnings,
    reasonCodes: params.reasonCodes,
  });

  return {
    resolvedSeeds,
    nodeById,
    fileByFileId,
    projectByProjectId,
    seedRelativePath: seedPathFromInput(params.input),
  };
}

function seedPathFromInput(
  parsed: ChangeImpactParsedInput,
): string | undefined {
  if (
    parsed.seed.kind === "file" ||
    parsed.seed.kind === "symbol" ||
    parsed.seed.kind === "caret"
  ) {
    return normalizeRelativePath(parsed.seed.relativePath);
  }
  return undefined;
}
