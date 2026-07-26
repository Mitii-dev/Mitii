import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';

/** Wires the Notifications controller/service/repository together for the app module. */
export class NotificationsModule {
  readonly repository = new NotificationsRepository();
  readonly service = new NotificationsService(this.repository);
  readonly controller = new NotificationsController(this.service);
}
