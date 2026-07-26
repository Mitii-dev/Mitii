import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminRepository } from './admin.repository';

/** Wires the Admin controller/service/repository together for the app module. */
export class AdminModule {
  readonly repository = new AdminRepository();
  readonly service = new AdminService(this.repository);
  readonly controller = new AdminController(this.service);
}
