import { NotificationsService } from './notifications.service';
import type { SendNotificationDto } from './dto/send-notification.dto';

/** HTTP entry points for the Notifications module, mounted at /notifications. */
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  async create(req: { body: SendNotificationDto }) {
    return this.notificationsService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.notificationsService.findById(req.params.id);
  }

  async findAll() {
    return this.notificationsService.list();
  }

  async sendEmailRoute(req: { params: { id?: string }; body: unknown }) {
    return this.notificationsService.sendEmail(req.params.id as string, req.body as never);
  }

  async sendPushRoute(req: { params: { id?: string }; body: unknown }) {
    return this.notificationsService.sendPush(req.params.id as string, req.body as never);
  }
}
