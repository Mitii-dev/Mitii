import { SupportTicketsController } from './support-tickets.controller';
import { SupportTicketsService } from './support-tickets.service';
import { SupportTicketsRepository } from './support-tickets.repository';

/** Wires the SupportTickets controller/service/repository together for the app module. */
export class SupportTicketsModule {
  readonly repository = new SupportTicketsRepository();
  readonly service = new SupportTicketsService(this.repository);
  readonly controller = new SupportTicketsController(this.service);
}
