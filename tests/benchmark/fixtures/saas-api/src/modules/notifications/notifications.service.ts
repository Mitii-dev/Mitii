import { NotificationsRepository } from './notifications.repository';
import type { SendNotificationDto } from './dto/send-notification.dto';
import type { NotificationPreferenceDto } from './dto/notification-preference.dto';

export interface Notification {
  id: string;
  userId: string;
  channel: string;
  body: string;
}

export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  async create(dto: SendNotificationDto): Promise<Notification> {
    return this.repository.insert(dto as Partial<Notification>);
  }

  async findById(id: string): Promise<Notification> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`Notification ${id} not found`);
    return row;
  }

  async list(): Promise<Notification[]> {
    return this.repository.findAll();
  }

  /**
   * Sends a transactional email via the configured email provider, skipping delivery if the user has opted out of the "email" channel.
   */
  async sendEmail(userId: string, subject: string, body: string): Promise<void> {
    const prefs = await this.repository.getPreferences(userId);
    if (!prefs.email) return;
    await this.emailProvider.send(userId, subject, body);
  }

  /**
   * Sends a push notification to all of a user's registered devices, batching by device token.
   */
  async sendPush(userId: string, body: string): Promise<void> {
    const tokens = await this.repository.getDeviceTokens(userId);
    await Promise.all(tokens.map((t) => this.pushProvider.send(t, body)));
  }
}
