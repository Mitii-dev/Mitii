import type { ReviewRecord } from "../output/ReviewArtifacts";

/**
 * Durable review-record store. Hosts typically persist under
 * `<workspace>/.mitii/review/`.
 */
export interface ReviewRecordStorePort {
  save(record: ReviewRecord): Promise<void>;
  load(recordId: string): Promise<ReviewRecord | undefined>;
  loadLatest(workspaceId: string): Promise<ReviewRecord | undefined>;
}
