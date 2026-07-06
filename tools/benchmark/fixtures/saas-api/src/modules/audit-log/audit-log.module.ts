import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { AuditLogRepository } from './audit-log.repository';

/** Wires the AuditLog controller/service/repository together for the app module. */
export class AuditLogModule {
  readonly repository = new AuditLogRepository();
  readonly service = new AuditLogService(this.repository);
  readonly controller = new AuditLogController(this.service);
}
