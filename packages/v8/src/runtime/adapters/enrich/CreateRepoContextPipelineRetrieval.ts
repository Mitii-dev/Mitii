/**
 * Repository-context module → RuntimeRepoContextRetrievalPort.
 */

import type { RepositoryContextPipeline } from "../../../modules/repository-context";
import type { RuntimeRepoContextRetrievalPort } from "../../ports/RuntimeEnrichRetrievalPorts";

export interface CreateRepoContextPipelineRetrievalOptions {
  pipeline: RepositoryContextPipeline;
  /** Factory builds full pipeline input; focusPaths come from enrich. */
  buildInput: (focusPaths: readonly string[]) => Parameters<
    RepositoryContextPipeline["execute"]
  >[0];
}

export function createRepoContextPipelineRetrieval(
  options: CreateRepoContextPipelineRetrievalOptions,
): RuntimeRepoContextRetrievalPort {
  return {
    async retrieve(input) {
      const max = input.maxItems ?? 24;
      const result = await options.pipeline.execute(
        options.buildInput(input.focusPaths),
      );

      const slices = result.assembly.blocks
        .slice(0, max)
        .map((block) => {
          const path = block.relativePath;
          const content = block.content?.trim() ?? "";
          if (path && content) return `${path}\n${content.slice(0, 2_000)}`;
          if (path) return path;
          return content.slice(0, 2_000);
        })
        .filter(Boolean);

      return {
        slices,
        reasonCodes: [
          "repo_pipeline_retrieved",
          `repo_status_${result.status}`,
        ],
      };
    },
  };
}
