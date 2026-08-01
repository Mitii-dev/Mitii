import { AuditLogRepository } from './audit-log.repository';
import type { CreateAuditEntryDto } from './dto/create-audit-entry.dto';
import type { QueryAuditLogDto } from './dto/query-audit-log.dto';

export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
}

export class AuditLogService {
  constructor(private readonly repository: AuditLogRepository) {}

  async create(dto: CreateAuditEntryDto): Promise<AuditEntry> {
    return this.repository.insert(dto as Partial<AuditEntry>);
  }

  async findById(id: string): Promise<AuditEntry> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`AuditEntry ${id} not found`);
    return row;
  }

  async list(): Promise<AuditEntry[]> {
    return this.repository.findAll();
  }

  /**
   * Writes an immutable audit-log entry recording who did what to which resource. Called by AdminService.impersonateUser and other sensitive actions.
   */
  async recordAuditEntry(dto: CreateAuditEntryDto): Promise<AuditEntry> {
    return this.repository.insert({ ...dto, recordedAt: new Date().toISOString() });
  }

  /**
   * Purges audit-log entries older than the configured retention window to satisfy data-retention policy.
   */
  async purgeOldEntries(olderThanDays: number): Promise<number> {
    return this.repository.deleteOlderThan(olderThanDays);
  }
}
