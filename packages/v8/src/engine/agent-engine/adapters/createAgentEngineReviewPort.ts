import type { ReviewPipeline } from "../../../modules/review";
import type { AgentEngineReviewPort } from "../contracts/ports/AgentEngineReviewPort";

/** Adapt ReviewPipeline to the Agent Engine review port. */
export function createAgentEngineReviewPort(
  pipeline: ReviewPipeline,
): AgentEngineReviewPort {
  return {
    preview: (input) => pipeline.preview(input),
    prepare: (input) => pipeline.prepare(input),
    finalize: (params) => pipeline.finalize(params),
    persistRecord: (record) => pipeline.persistRecord(record),
    loadLatestRecord: (workspaceId) => pipeline.loadLatest(workspaceId),
  };
}
