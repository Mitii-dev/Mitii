import type { Order } from '../../types/domain.js';
import { processNotifications } from './service.js';
import { toNotificationsEventDto, type NotificationsEventDto } from './dto.js';

export function handleNotificationsEvent(order: Order): NotificationsEventDto {
  processNotifications(order);
  return toNotificationsEventDto(order);
}
