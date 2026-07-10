import { UsersService } from './users.service';
import type { CreateUserDto } from './dto/create-user.dto';

/** HTTP entry points for the Users module, mounted at /users. */
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  async create(req: { body: CreateUserDto }) {
    return this.usersService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.usersService.findById(req.params.id);
  }

  async findAll() {
    return this.usersService.list();
  }

  async deactivateUserRoute(req: { params: { id?: string }; body: unknown }) {
    return this.usersService.deactivateUser(req.params.id as string, req.body as never);
  }

  async mergeDuplicateAccountsRoute(req: { params: { id?: string }; body: unknown }) {
    return this.usersService.mergeDuplicateAccounts(req.params.id as string, req.body as never);
  }
}
