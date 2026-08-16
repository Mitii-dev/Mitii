import type { VerificationRecord } from "../output/VerificationRecord";

/**
 * Durable store for verification records. Hosts typically persist under
 * `<workspace>/.mitii/verification/`. Tests use the in-memory adapter.
 *
 * Records MUST NOT be injected into model-loop messages.
 */
export interface VerificationRecordStorePort {
  save(record: VerificationRecord): Promise<void>;
  load(recordId: string): Promise<VerificationRecord | undefined>;
  loadLatest(workspaceId: string): Promise<VerificationRecord | undefined>;
}
