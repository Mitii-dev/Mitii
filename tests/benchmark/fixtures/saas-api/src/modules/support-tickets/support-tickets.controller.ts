import { SupportTicketsService } from './support-tickets.service';
import type { CreateTicketDto } from './dto/create-ticket.dto';

/** HTTP entry points for the SupportTickets module, mounted at /support-tickets. */
export class SupportTicketsController {
  constructor(private readonly supportTicketsService: SupportTicketsService) {}

  async create(req: { body: CreateTicketDto }) {
    return this.supportTicketsService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.supportTicketsService.findById(req.params.id);
  }

  async findAll() {
    return this.supportTicketsService.list();
  }

  async escalateTicketRoute(req: { params: { id?: string }; body: unknown }) {
    return this.supportTicketsService.escalateTicket(req.params.id as string, req.body as never);
  }

  async closeTicketRoute(req: { params: { id?: string }; body: unknown }) {
    return this.supportTicketsService.closeTicket(req.params.id as string, req.body as never);
  }
}
