import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';

/** Wires the Users controller/service/repository together for the app module. */
export class UsersModule {
  readonly repository = new UsersRepository();
  readonly service = new UsersService(this.repository);
  readonly controller = new UsersController(this.service);
}
