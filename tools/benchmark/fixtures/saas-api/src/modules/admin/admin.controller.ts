import { AdminService } from './admin.service';
import type { ImpersonateUserDto } from './dto/impersonate-user.dto';

/** HTTP entry points for the Admin module, mounted at /admin. */
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  async create(req: { body: ImpersonateUserDto }) {
    return this.adminService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.adminService.findById(req.params.id);
  }

  async findAll() {
    return this.adminService.list();
  }

  async impersonateUserRoute(req: { params: { id?: string }; body: unknown }) {
    return this.adminService.impersonateUser(req.params.id as string, req.body as never);
  }

  async suspendAccountRoute(req: { params: { id?: string }; body: unknown }) {
    return this.adminService.suspendAccount(req.params.id as string, req.body as never);
  }
}
