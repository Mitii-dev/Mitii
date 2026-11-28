/**
 * Adapter: PromptConstructionPipeline → RuntimePromptConstructionPort.
 */

import {
  PromptConstructionPipeline,
  type PromptConstructionPipelineOptions,
} from "../../../modules/prompt-construction";
import type { RuntimePromptConstructionPort } from "../../ports/RuntimePromptConstructionPort";

export function createPromptConstructionPort(
  options?: PromptConstructionPipelineOptions,
): RuntimePromptConstructionPort {
  const pipeline = new PromptConstructionPipeline(options);
  return {
    construct(input) {
      return pipeline.construct(input);
    },
  };
}
