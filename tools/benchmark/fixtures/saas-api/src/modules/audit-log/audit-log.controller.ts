import { AuditLogService } from './audit-log.service';
import type { CreateAuditEntryDto } from './dto/create-audit-entry.dto';

/** HTTP entry points for the AuditLog module, mounted at /audit-log. */
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  async create(req: { body: CreateAuditEntryDto }) {
    return this.auditLogService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.auditLogService.findById(req.params.id);
  }

  async findAll() {
    return this.auditLogService.list();
  }

  async recordAuditEntryRoute(req: { params: { id?: string }; body: unknown }) {
    return this.auditLogService.recordAuditEntry(req.params.id as string, req.body as never);
  }

  async purgeOldEntriesRoute(req: { params: { id?: string }; body: unknown }) {
    return this.auditLogService.purgeOldEntries(req.params.id as string, req.body as never);
  }
}
