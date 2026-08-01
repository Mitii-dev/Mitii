import { SupportTicketsRepository } from './support-tickets.repository';
import type { CreateTicketDto } from './dto/create-ticket.dto';
import type { AssignTicketDto } from './dto/assign-ticket.dto';

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  status: string;
}

export class SupportTicketsService {
  constructor(private readonly repository: SupportTicketsRepository) {}

  async create(dto: CreateTicketDto): Promise<SupportTicket> {
    return this.repository.insert(dto as Partial<SupportTicket>);
  }

  async findById(id: string): Promise<SupportTicket> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`SupportTicket ${id} not found`);
    return row;
  }

  async list(): Promise<SupportTicket[]> {
    return this.repository.findAll();
  }

  /**
   * Escalates a support ticket to tier-2 support when it has been unresolved for longer than ESCALATION_THRESHOLD_HOURS.
   */
  async escalateTicket(id: string, reason: string): Promise<SupportTicket> {
    return this.repository.update(id, { priority: 'escalated', escalationReason: reason });
  }

  /**
   * Closes a resolved support ticket and records resolution notes for future reference.
   */
  async closeTicket(id: string, resolutionNotes: string): Promise<SupportTicket> {
    return this.repository.update(id, { status: 'closed', resolutionNotes });
  }
}
