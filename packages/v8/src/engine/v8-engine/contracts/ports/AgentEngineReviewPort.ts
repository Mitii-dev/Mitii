import type {
  ReviewInput,
  ReviewPrepResult,
  ReviewPreview,
  ReviewRecord,
  ReviewResult,
} from "../../../../modules/review";

/**
 * Optional review facade for Agent Engine.
 * Hosts inject ReviewPipeline; omitting leaves review intent on diagnose+skill only.
 */
export interface AgentEngineReviewPort {
  preview(input: ReviewInput): ReviewPreview;
  prepare(input: ReviewInput): ReviewPrepResult;
  finalize(params: {
    input: ReviewInput;
    rawFindings?: unknown;
    findings?: ReviewResult["findings"];
    prep?: ReviewPrepResult;
    persist?: boolean;
  }): Promise<ReviewResult>;
  persistRecord?(record: ReviewRecord): Promise<void>;
  loadLatestRecord?(
    workspaceId: string,
  ): Promise<ReviewRecord | undefined>;
}
