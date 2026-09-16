import type { ReviewRecord } from "../contracts";
import type { ReviewRecordStorePort } from "../contracts";

export class InMemoryReviewRecordStore implements ReviewRecordStorePort {
  private readonly records = new Map<string, ReviewRecord>();

  public async save(record: ReviewRecord): Promise<void> {
    this.records.set(record.recordId, record);
  }

  public async load(recordId: string): Promise<ReviewRecord | undefined> {
    return this.records.get(recordId);
  }

  public async loadLatest(
    workspaceId: string,
  ): Promise<ReviewRecord | undefined> {
    const matches = [...this.records.values()].filter(
      (record) => record.workspaceId === workspaceId,
    );
    if (matches.length === 0) return undefined;
    return matches.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0];
  }
}
