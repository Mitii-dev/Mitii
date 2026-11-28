/**
 * Memory module → RuntimeMemoryRetrievalPort.
 */

import {
  MEMORY_SCHEMA_VERSION,
  type MemoryPipeline,
  type MemoryScope,
} from "../../../modules/memory";
import type { RuntimeMemoryRetrievalPort } from "../../ports/RuntimeEnrichRetrievalPorts";

export interface CreateMemoryPipelineRetrievalOptions {
  pipeline: MemoryPipeline;
  scope: MemoryScope;
}

export function createMemoryPipelineRetrieval(
  options: CreateMemoryPipelineRetrievalOptions,
): RuntimeMemoryRetrievalPort {
  return {
    async retrieve(input) {
      const max = input.maxItems ?? 24;
      const result = await options.pipeline.retrieve({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        query: input.query.trim() || "memory",
        scope: options.scope,
        maxFacts: max,
        fileTargets: [...(input.focusPaths ?? [])],
      });

      const facts = result.instructions
        .slice(0, max)
        .map((block) => block.content);

      return {
        facts,
        reasonCodes: [
          "memory_pipeline_retrieved",
          ...result.reasonCodes.map(String),
        ],
      };
    },
  };
}
