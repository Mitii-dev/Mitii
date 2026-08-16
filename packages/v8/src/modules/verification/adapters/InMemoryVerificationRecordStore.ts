import type { VerificationRecord } from "../contracts";
import type { VerificationRecordStorePort } from "../contracts";

/**
 * Process-local verification record store for tests and in-process SDK use.
 */
export class InMemoryVerificationRecordStore
  implements VerificationRecordStorePort
{
  private readonly records = new Map<string, VerificationRecord>();

  public async save(record: VerificationRecord): Promise<void> {
    this.records.set(record.recordId, record);
  }

  public async load(
    recordId: string,
  ): Promise<VerificationRecord | undefined> {
    return this.records.get(recordId);
  }

  public async loadLatest(
    workspaceId: string,
  ): Promise<VerificationRecord | undefined> {
    const matches = [...this.records.values()].filter(
      (record) => record.workspaceId === workspaceId,
    );
    if (matches.length === 0) {
      return undefined;
    }
    return matches.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0];
  }
}
