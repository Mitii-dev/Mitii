import { AdminRepository } from './admin.repository';
import type { ImpersonateUserDto } from './dto/impersonate-user.dto';
import type { AuditActionDto } from './dto/audit-action.dto';

export interface AdminAction {
  id: string;
  adminId: string;
  action: string;
  targetId: string;
}

export class AdminService {
  constructor(private readonly repository: AdminRepository) {}

  async create(dto: ImpersonateUserDto): Promise<AdminAction> {
    return this.repository.insert(dto as Partial<AdminAction>);
  }

  async findById(id: string): Promise<AdminAction> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`AdminAction ${id} not found`);
    return row;
  }

  async list(): Promise<AdminAction[]> {
    return this.repository.findAll();
  }

  /**
   * Generates a short-lived impersonation token letting a support admin act as a user for debugging, and writes an audit-log entry recording who impersonated whom.
   */
  async impersonateUser(adminId: string, dto: ImpersonateUserDto): Promise<string> {
    await this.auditLogService.recordAuditEntry({ actorId: adminId, action: 'impersonate', targetId: dto.targetUserId });
    return this.authService.generateAccessToken(dto.targetUserId);
  }

  /**
   * Immediately suspends a user account for policy violations, revoking active sessions.
   */
  async suspendAccount(targetUserId: string, reason: string): Promise<void> {
    await this.usersService.deactivateUser(targetUserId, reason);
  }
}
