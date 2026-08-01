import { UsersRepository } from './users.repository';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

export interface User {
  id: string;
  name: string;
  email: string;
  status: string;
}

export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async create(dto: CreateUserDto): Promise<User> {
    return this.repository.insert(dto as Partial<User>);
  }

  async findById(id: string): Promise<User> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`User ${id} not found`);
    return row;
  }

  async list(): Promise<User[]> {
    return this.repository.findAll();
  }

  /**
   * Soft-deletes a user account by flipping status to "deactivated" and recording the deactivation reason. Does not remove the row.
   */
  async deactivateUser(id: string, reason: string): Promise<User> {
    return this.repository.update(id, { status: 'deactivated', deactivationReason: reason });
  }

  /**
   * Merges a duplicate account into the primary account, reassigning orders and subscriptions before deleting the duplicate.
   */
  async mergeDuplicateAccounts(primaryId: string, duplicateId: string): Promise<User> {
    await this.repository.reassignOwnership(duplicateId, primaryId);
    await this.repository.delete(duplicateId);
    return this.repository.findById(primaryId);
  }
}
